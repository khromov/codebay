import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the DB at a throwaway dir *before* importing db.server (config.server reads
// DATA_DIR at module-eval time, and db.server opens the connection on import).
const dataDir = mkdtempSync(join(tmpdir(), 'dcm-db-'));
process.env.DATA_DIR = dataDir;

// Type-only import is fully erased, so it doesn't evaluate db.server before DATA_DIR is set.
import type { InstanceRow } from './db.server.ts';

const db = await import('./db.server.ts');

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function makeInstance(id: string, hostPort: number): InstanceRow {
	return {
		id,
		name: id,
		source_path: '/tmp/src',
		workspace_path: '/tmp/ws',
		host_port: hostPort,
		container_id: null,
		remote_workspace_folder: null,
		status: 'creating',
		error: null,
		created_at: Date.now(),
		bridge_token: 'tok',
		remote_user: null,
		image_source: null
	};
}

describe('usedPorts union + port_forwards helpers', () => {
	beforeAll(() => {
		db.insertInstance(makeInstance('a', 8001));
		db.insertInstance(makeInstance('b', 8002));
	});

	test('usedPorts unions instance host ports with forwarded host ports', () => {
		db.insertForward({
			instance_id: 'a',
			container_port: 3000,
			host_port: 8003,
			created_at: Date.now()
		});
		db.insertForward({
			instance_id: 'a',
			container_port: 5173,
			host_port: 8004,
			created_at: Date.now()
		});
		expect(db.usedPorts().sort((x, y) => x - y)).toEqual([8001, 8002, 8003, 8004]);
	});

	test('listForwards returns only the instance rows; deleteForward drops one', () => {
		expect(db.listForwards('a').map((f) => f.container_port)).toEqual([3000, 5173]);
		db.deleteForward('a', 3000);
		expect(db.listForwards('a').map((f) => f.container_port)).toEqual([5173]);
		expect(db.usedPorts()).not.toContain(8003);
	});

	test('deleteForwards removes every forward for an instance', () => {
		db.deleteForwards('a');
		expect(db.listForwards('a')).toEqual([]);
		expect(db.usedPorts().sort((x, y) => x - y)).toEqual([8001, 8002]);
	});
});

describe('options key/value helpers', () => {
	test('getOption returns null when unset', () => {
		expect(db.getOption('default_image')).toBeNull();
	});

	test('setOption stores and overwrites a value', () => {
		db.setOption('default_image', 'my/image:1');
		expect(db.getOption('default_image')).toBe('my/image:1');
		db.setOption('default_image', 'other/image:2');
		expect(db.getOption('default_image')).toBe('other/image:2');
	});
});

describe('updateInstance image_source + insert round-trip', () => {
	test('image_source persists through insert and update', () => {
		db.insertInstance(makeInstance('img', 8101));
		expect(db.getInstance('img')?.image_source).toBeNull();
		db.updateInstance('img', { image_source: 'local' });
		expect(db.getInstance('img')?.image_source).toBe('local');
		db.updateInstance('img', { image_source: 'mcr.microsoft.com/devcontainers/universal:2' });
		expect(db.getInstance('img')?.image_source).toBe('mcr.microsoft.com/devcontainers/universal:2');
	});
});
