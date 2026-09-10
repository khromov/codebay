import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	deleteForward,
	deleteForwards,
	deleteInstanceRow,
	getInstance,
	insertInstance,
	listForwards,
	type InstanceRow
} from './db.server.ts';
import { seedProjectPorts } from './instances.server.ts';

/**
 * `hostPortsInUse()` and `isHostPortBindable()` are what a pinned port is checked against, so the
 * docker stub keeps the pin path off a real daemon; port 9999 stands in for "already taken".
 */
const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };
const TAKEN_HOST_PORT = 9999;

let seq = 0;
const seeded: string[] = [];

function makeWorkspace(files: { devcontainer?: string; codebay?: string }): string {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-ports-'));
	if (files.devcontainer) {
		mkdirSync(join(dir, '.devcontainer'));
		writeFileSync(join(dir, '.devcontainer', 'devcontainer.json'), files.devcontainer, 'utf8');
	}
	if (files.codebay) writeFileSync(join(dir, 'codebay.json'), files.codebay, 'utf8');
	return dir;
}

function seed(workspacePath: string): InstanceRow {
	const row: InstanceRow = {
		id: `ports-${seq++}`,
		name: 'ports',
		source_path: workspacePath,
		workspace_path: workspacePath,
		host_port: 8500 + seq,
		container_id: null,
		remote_workspace_folder: null,
		status: 'creating',
		error: null,
		created_at: Date.now(),
		bridge_token: 't',
		remote_user: null,
		image_source: null,
		avatar: null,
		mode: 'ide',
		terminal_split: 0,
		config_migrated: 1,
		seeded_ports: null
	};
	insertInstance(row);
	seeded.push(row.id);
	return row;
}

const forwards = (id: string) =>
	listForwards(id).map((f) => ({ container_port: f.container_port, label: f.label }));

beforeEach(() => {
	g.__codebayDocker = Promise.resolve({
		listContainers: async () => [{ Ports: [{ PublicPort: TAKEN_HOST_PORT }] }]
	});
});

afterEach(() => {
	g.__codebayDocker = undefined;
	// Nothing cascades off `instances`, so a leaked forward would break another file's usedPorts().
	for (const id of seeded.splice(0)) {
		deleteForwards(id);
		deleteInstanceRow(id);
	}
});

describe('seedProjectPorts', () => {
	test('merges declared devcontainer ports with codebay.json names', async () => {
		const dir = makeWorkspace({
			devcontainer: '{ "forwardPorts": [3000, 5173] }',
			codebay: '{ "ports": { "3000": "web", "9229": "debug" } }'
		});
		const row = seed(dir);
		await seedProjectPorts(row);
		expect(forwards(row.id)).toEqual([
			{ container_port: 3000, label: 'web' },
			{ container_port: 5173, label: null },
			{ container_port: 9229, label: 'debug' }
		]);
	});

	test('honours a pinned host port and falls back when it is taken', async () => {
		const dir = makeWorkspace({
			codebay: `{ "ports": { "8123:5173": "vite", "${TAKEN_HOST_PORT}:3000": "web" } }`
		});
		const row = seed(dir);
		await seedProjectPorts(row);
		const byPort = new Map(listForwards(row.id).map((f) => [f.container_port, f.host_port]));
		expect(byPort.get(5173)).toBe(8123);
		expect(byPort.get(3000)).not.toBe(TAKEN_HOST_PORT);
	});

	test('a re-seed applies a renamed port without duplicating the forward', async () => {
		const dir = makeWorkspace({ codebay: '{ "ports": { "3000": "web" } }' });
		const row = seed(dir);
		await seedProjectPorts(row);
		writeFileSync(join(dir, 'codebay.json'), '{ "ports": { "3000": "api" } }', 'utf8');
		await seedProjectPorts(getInstance(row.id)!);
		expect(forwards(row.id)).toEqual([{ container_port: 3000, label: 'api' }]);
	});

	test('a port removed by hand is not resurrected by the next re-seed', async () => {
		const dir = makeWorkspace({ devcontainer: '{ "forwardPorts": [3000] }' });
		const row = seed(dir);
		await seedProjectPorts(row);
		deleteForward(row.id, 3000);
		await seedProjectPorts(getInstance(row.id)!);
		expect(forwards(row.id)).toEqual([]);
	});

	test('a port newly added to codebay.json still arrives on the next re-seed', async () => {
		const dir = makeWorkspace({ codebay: '{ "ports": { "3000": "web" } }' });
		const row = seed(dir);
		await seedProjectPorts(row);
		writeFileSync(
			join(dir, 'codebay.json'),
			'{ "ports": { "3000": "web", "5173": "vite" } }',
			'utf8'
		);
		await seedProjectPorts(getInstance(row.id)!);
		expect(forwards(row.id)).toEqual([
			{ container_port: 3000, label: 'web' },
			{ container_port: 5173, label: 'vite' }
		]);
	});

	test('skips the mode’s reserved surface port', async () => {
		const dir = makeWorkspace({ codebay: '{ "ports": { "8080": "editor" } }' });
		const row = seed(dir);
		await seedProjectPorts(row);
		expect(forwards(row.id)).toEqual([]);
	});
});
