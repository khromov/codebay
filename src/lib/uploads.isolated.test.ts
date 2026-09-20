import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertInstance, setOption, type InstanceRow } from './db.server.ts';
import {
	UPLOAD_ENABLED_KEY,
	UPLOAD_MAX_BYTES,
	safeUploadName,
	saveUpload,
	uniqueName,
	uploadEnabled,
	uploadRoutes
} from './uploads.server.ts';

afterEach(() => setOption(UPLOAD_ENABLED_KEY, '0'));

let seq = 0;
function seed(overrides: Partial<InstanceRow> = {}): InstanceRow {
	const ws = mkdtempSync(join(tmpdir(), 'codebay-upload-'));
	const row: InstanceRow = {
		id: `upload-inst-${++seq}`,
		name: `upload-inst-${seq}`,
		source_path: '/src',
		workspace_path: ws,
		host_port: 8200 + seq,
		container_id: 'container-upload',
		remote_workspace_folder: '/workspaces/proj',
		status: 'running',
		error: null,
		created_at: Date.now(),
		bridge_token: 'tok',
		remote_user: 'node',
		image_source: 'local',
		avatar: null,
		mode: 'ide',
		terminal_split: 0,
		config_migrated: 1,
		...overrides
	};
	insertInstance(row);
	return row;
}

describe('safeUploadName', () => {
	test.each(['', '.', '..', '../x', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(201)])(
		'rejects %j',
		(raw) => {
			expect(() => safeUploadName(raw)).toThrow('invalid file name');
		}
	);

	test.each(['photo.png', 'my file (1).PNG'])('accepts %j', (raw) => {
		expect(safeUploadName(raw)).toBe(raw);
	});
});

describe('uniqueName', () => {
	test('returns the bare name when nothing collides', () => {
		const dir = mkdtempSync(join(tmpdir(), 'codebay-unique-'));
		expect(uniqueName(dir, 'photo.png')).toBe('photo.png');
	});

	test('picks name-1.ext, then name-2.ext, preserving the original', () => {
		const dir = mkdtempSync(join(tmpdir(), 'codebay-unique-'));
		writeFileSync(join(dir, 'photo.png'), 'first');
		expect(uniqueName(dir, 'photo.png')).toBe('photo-1.png');
		writeFileSync(join(dir, 'photo-1.png'), 'second');
		expect(uniqueName(dir, 'photo.png')).toBe('photo-2.png');
		expect(readFileSync(join(dir, 'photo.png'), 'utf8')).toBe('first');
	});
});

describe('saveUpload', () => {
	test('writes into codebay-inbox/, returns the container path and byte count, seeds .gitignore', async () => {
		const row = seed();
		const saved = await saveUpload(row, 'photo.png', new Blob(['hello']));
		expect(saved.name).toBe('photo.png');
		expect(saved.bytes).toBe(5);
		expect(saved.containerPath).toBe('/workspaces/proj/codebay-inbox/photo.png');
		expect(readFileSync(join(row.workspace_path, 'codebay-inbox', 'photo.png'), 'utf8')).toBe(
			'hello'
		);
		expect(readFileSync(join(row.workspace_path, 'codebay-inbox', '.gitignore'), 'utf8')).toBe(
			'*\n!.gitignore\n'
		);
		rmSync(row.workspace_path, { recursive: true, force: true });
	});

	test('a second upload with the same name lands as name-1, the original untouched', async () => {
		const row = seed();
		await saveUpload(row, 'photo.png', new Blob(['first']));
		const second = await saveUpload(row, 'photo.png', new Blob(['second']));
		expect(second.name).toBe('photo-1.png');
		expect(readFileSync(join(row.workspace_path, 'codebay-inbox', 'photo.png'), 'utf8')).toBe(
			'first'
		);
		expect(readFileSync(join(row.workspace_path, 'codebay-inbox', 'photo-1.png'), 'utf8')).toBe(
			'second'
		);
		rmSync(row.workspace_path, { recursive: true, force: true });
	});

	test('refuses a symlinked codebay-inbox pointing outside the workspace, writing nothing', async () => {
		const row = seed();
		const outside = mkdtempSync(join(tmpdir(), 'codebay-outside-'));
		symlinkSync(outside, join(row.workspace_path, 'codebay-inbox'));
		await expect(saveUpload(row, 'photo.png', new Blob(['x']))).rejects.toThrow(
			'codebay-inbox is not a directory'
		);
		expect(existsSync(join(outside, 'photo.png'))).toBe(false);
		rmSync(row.workspace_path, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	test('throws when the instance has not booted yet', async () => {
		const row = seed({ remote_workspace_folder: null });
		await expect(saveUpload(row, 'photo.png', new Blob(['x']))).rejects.toThrow(
			'Instance has not booted yet'
		);
		rmSync(row.workspace_path, { recursive: true, force: true });
	});

	test('throws when the workspace folder is not on disk yet', async () => {
		const row = seed({ workspace_path: join(tmpdir(), 'codebay-upload-missing-does-not-exist') });
		await expect(saveUpload(row, 'photo.png', new Blob(['x']))).rejects.toThrow(
			'Workspace folder is not on disk yet'
		);
	});
});

describe('uploadEnabled', () => {
	test('is off by default, on once the option is set', () => {
		expect(uploadEnabled()).toBe(false);
		setOption(UPLOAD_ENABLED_KEY, '1');
		expect(uploadEnabled()).toBe(true);
	});
});

describe('upload route gate', () => {
	const route = uploadRoutes['/api/instances/:id/upload'] as unknown as {
		handler: (event: {
			request: Request;
			method: string;
			url: URL;
			params: Record<string, string>;
		}) => Promise<Response>;
	};

	function call(
		id: string,
		opts: { body?: BodyInit; name?: string; contentLength?: number } = {}
	): Promise<Response> {
		const url = new URL(
			`http://localhost:6969/api/instances/${id}/upload${opts.name ? `?name=${encodeURIComponent(opts.name)}` : ''}`
		);
		const headers = new Headers();
		if (opts.contentLength !== undefined) {
			headers.set('content-length', String(opts.contentLength));
		}
		const request = new Request(url, { method: 'POST', headers, body: opts.body });
		return route.handler({ request, method: 'POST', url, params: { id } });
	}

	test('404s while the option is off, even for a real instance', async () => {
		const row = seed();
		const res = await call(row.id, { body: new Blob(['x']), name: 'x.txt', contentLength: 1 });
		expect(res.status).toBe(404);
		rmSync(row.workspace_path, { recursive: true, force: true });
	});

	describe('once enabled', () => {
		beforeEach(() => setOption(UPLOAD_ENABLED_KEY, '1'));

		test('404s for an unknown instance id', async () => {
			const res = await call('nope-no-such-instance', {
				body: new Blob(['x']),
				name: 'x.txt',
				contentLength: 1
			});
			expect(res.status).toBe(404);
		});

		test('413s when content-length exceeds the cap', async () => {
			const row = seed();
			const res = await call(row.id, {
				body: new Blob(['x']),
				name: 'x.txt',
				contentLength: UPLOAD_MAX_BYTES + 1
			});
			expect(res.status).toBe(413);
			rmSync(row.workspace_path, { recursive: true, force: true });
		});

		test('400s on a bad name', async () => {
			const row = seed();
			const res = await call(row.id, { body: new Blob(['x']), name: '../x', contentLength: 1 });
			expect(res.status).toBe(400);
			rmSync(row.workspace_path, { recursive: true, force: true });
		});

		test('201s with the saved file on a good upload', async () => {
			const row = seed();
			const res = await call(row.id, {
				body: new Blob(['hello']),
				name: 'ok.txt',
				contentLength: 5
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as { file: { containerPath: string } };
			expect(body.file.containerPath).toBe('/workspaces/proj/codebay-inbox/ok.txt');
			rmSync(row.workspace_path, { recursive: true, force: true });
		});
	});
});
