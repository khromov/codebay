import { afterEach, describe, expect, test } from 'bun:test';
import { removeContainer } from './docker.server.ts';

/**
 * `getDocker()` resolves a dockerode client pinned to `globalThis.__dcmDocker`.
 * We seed that slot with a fake client so `removeContainer` runs against an
 * in-memory stub — no real daemon involved.
 */
const g = globalThis as unknown as { __dcmDocker?: Promise<unknown> };

type Mount = { Type: string; Name?: string };
type VolumeStub = { remove: (opts?: unknown) => Promise<unknown> };

/** Build a fake dockerode client and record the calls made against it. */
function fakeDocker(opts: {
	mounts?: Mount[];
	inspectStatus?: number; // reject inspect() with this HTTP status
	removeStatus?: number; // reject container.remove() with this HTTP status
	volumeRemove?: (name: string) => Promise<unknown>; // per-volume remove behavior
}) {
	const calls = {
		removeOpts: undefined as unknown,
		volumesRemoved: [] as string[]
	};
	const err = (status: number) =>
		Object.assign(new Error(`http ${status}`), { statusCode: status });

	const container = {
		inspect: async () => {
			if (opts.inspectStatus) throw err(opts.inspectStatus);
			return { Mounts: opts.mounts ?? [] };
		},
		remove: async (o: unknown) => {
			calls.removeOpts = o;
			if (opts.removeStatus) throw err(opts.removeStatus);
		}
	};

	const docker = {
		getContainer: (_id: string) => container,
		getVolume: (name: string): VolumeStub => ({
			remove: async () => {
				calls.volumesRemoved.push(name);
				if (opts.volumeRemove) return opts.volumeRemove(name);
				return undefined;
			}
		})
	};

	g.__dcmDocker = Promise.resolve(docker);
	return calls;
}

describe('removeContainer', () => {
	afterEach(() => {
		g.__dcmDocker = undefined;
	});

	test('removes the container with force + v (drops anonymous volumes)', async () => {
		const calls = fakeDocker({ mounts: [] });
		expect(await removeContainer('c1')).toBe(true);
		expect(calls.removeOpts).toEqual({ force: true, v: true });
	});

	test('removes named volumes but skips bind mounts', async () => {
		const calls = fakeDocker({
			mounts: [
				{ Type: 'volume', Name: 'named-vol' },
				{ Type: 'bind', Source: '/host/workspace' } as Mount,
				{ Type: 'volume', Name: 'other-vol' }
			]
		});
		expect(await removeContainer('c1')).toBe(true);
		expect(calls.volumesRemoved.sort()).toEqual(['named-vol', 'other-vol']);
	});

	test('ignores volumes with no Name', async () => {
		const calls = fakeDocker({ mounts: [{ Type: 'volume' }] });
		expect(await removeContainer('c1')).toBe(true);
		expect(calls.volumesRemoved).toEqual([]);
	});

	test('still succeeds when a volume remove rejects (404/409)', async () => {
		const calls = fakeDocker({
			mounts: [{ Type: 'volume', Name: 'gone' }],
			volumeRemove: async () => {
				throw Object.assign(new Error('conflict'), { statusCode: 409 });
			}
		});
		expect(await removeContainer('c1')).toBe(true);
		expect(calls.volumesRemoved).toEqual(['gone']);
	});

	test('treats an already-absent container (inspect 404) as success, no volume work', async () => {
		const calls = fakeDocker({ inspectStatus: 404, mounts: [{ Type: 'volume', Name: 'x' }] });
		expect(await removeContainer('c1')).toBe(true);
		expect(calls.removeOpts).toBeUndefined(); // never reached remove()
		expect(calls.volumesRemoved).toEqual([]);
	});

	test('treats a remove-time 404 as success and still cleans named volumes', async () => {
		const calls = fakeDocker({
			mounts: [{ Type: 'volume', Name: 'v1' }],
			removeStatus: 404
		});
		expect(await removeContainer('c1')).toBe(true);
		expect(calls.volumesRemoved).toEqual(['v1']);
	});
});
