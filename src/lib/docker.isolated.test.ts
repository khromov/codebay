import { afterEach, describe, expect, test } from 'bun:test';
import {
	builtImages,
	hostPortsInUse,
	removeContainer,
	removeContainerOnly,
	removeImages
} from './docker.server.ts';

/**
 * `getDocker()` resolves a dockerode client pinned to `globalThis.__codebayDocker`.
 * We seed that slot with a fake client so `removeContainer` runs against an
 * in-memory stub — no real daemon involved.
 */
const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };

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

	g.__codebayDocker = Promise.resolve(docker);
	return calls;
}

describe('removeContainer', () => {
	afterEach(() => {
		g.__codebayDocker = undefined;
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

describe('removeContainerOnly', () => {
	afterEach(() => {
		g.__codebayDocker = undefined;
	});

	test('never passes v — a rebuild must not destroy the container’s anonymous volumes', async () => {
		const calls = fakeDocker({});
		expect(await removeContainerOnly('c1')).toBe(true);
		// The CLI's own --remove-existing-container is `docker rm -f` without -v; match it exactly.
		expect(calls.removeOpts).toEqual({ force: true });
	});

	test('treats an already-absent container (404) as success', async () => {
		fakeDocker({ removeStatus: 404 });
		expect(await removeContainerOnly('c1')).toBe(true);
	});

	test('reports failure on any other daemon error so the caller can warn', async () => {
		fakeDocker({ removeStatus: 500 });
		expect(await removeContainerOnly('c1')).toBe(false);
	});
});

describe('hostPortsInUse', () => {
	afterEach(() => {
		g.__codebayDocker = undefined;
	});

	test('collects published host ports across every running container, deduped', async () => {
		g.__codebayDocker = Promise.resolve({
			listContainers: async () => [
				{ Ports: [{ PrivatePort: 8080, PublicPort: 8001, Type: 'tcp' }] },
				{
					Ports: [
						{ PrivatePort: 3333, PublicPort: 8002, Type: 'tcp' },
						{ PrivatePort: 8080, PublicPort: 8001, Type: 'tcp' } // dup, e.g. seen on two networks
					]
				}
			]
		});
		expect((await hostPortsInUse()).sort()).toEqual([8001, 8002]);
	});

	test('skips exposed-but-not-published ports (no PublicPort)', async () => {
		g.__codebayDocker = Promise.resolve({
			listContainers: async () => [{ Ports: [{ PrivatePort: 8080, Type: 'tcp' }] }]
		});
		expect(await hostPortsInUse()).toEqual([]);
	});

	test('returns [] when a container has no Ports field', async () => {
		g.__codebayDocker = Promise.resolve({ listContainers: async () => [{}] });
		expect(await hostPortsInUse()).toEqual([]);
	});

	test('returns [] when the daemon is unreachable', async () => {
		g.__codebayDocker = Promise.resolve({
			listContainers: async () => {
				throw new Error('connect ECONNREFUSED');
			}
		});
		expect(await hostPortsInUse()).toEqual([]);
	});
});

const HASH = 'a'.repeat(64);
const BASE = `vsc-ws-${HASH}`;
const httpErr = (status: number) =>
	Object.assign(new Error(`http ${status}`), { statusCode: status });

/** A fake image store: `images` maps a ref (tag or id) to its inspect result; `removeFails` rejects removal. */
function fakeImages(opts: {
	containerImage?: string;
	images?: Record<string, { Id: string; RepoTags?: string[] }>;
	removeFails?: Record<string, number>;
}) {
	const removed: string[] = [];
	g.__codebayDocker = Promise.resolve({
		getContainer: () => ({
			inspect: async () => ({ Config: { Image: opts.containerImage } })
		}),
		getImage: (ref: string) => ({
			inspect: async () => {
				const image = opts.images?.[ref];
				if (!image) throw httpErr(404);
				return image;
			},
			remove: async () => {
				const status = opts.removeFails?.[ref];
				if (status) throw httpErr(status);
				removed.push(ref);
			}
		})
	});
	return removed;
}

describe('builtImages', () => {
	afterEach(() => {
		g.__codebayDocker = undefined;
	});

	test('resolves the CLI tag chain the container runs on, children before parents', async () => {
		fakeImages({
			containerImage: `${BASE}-features-uid`,
			images: {
				[`${BASE}-features-uid`]: { Id: 'sha256:uid' },
				[`${BASE}-features`]: { Id: 'sha256:features' }
			}
		});
		expect(await builtImages('c1')).toEqual([
			{ tag: `${BASE}-features-uid`, id: 'sha256:uid' },
			{ tag: `${BASE}-features`, id: 'sha256:features' }
		]);
	});

	test('includes the bare Dockerfile build under its layers', async () => {
		fakeImages({
			containerImage: `${BASE}-uid:latest`,
			images: { [`${BASE}-uid`]: { Id: 'sha256:uid' }, [BASE]: { Id: 'sha256:base' } }
		});
		expect((await builtImages('c1')).map((i) => i.tag)).toEqual([`${BASE}-uid`, BASE]);
	});

	test('never claims an image the CLI did not tag for this workspace', async () => {
		for (const containerImage of [
			'mcr.microsoft.com/devcontainers/base:ubuntu',
			'vsc-ws-not-a-hash-features',
			undefined
		]) {
			fakeImages({ containerImage, images: { [`${BASE}-features`]: { Id: 'sha256:x' } } });
			expect(await builtImages('c1')).toEqual([]);
		}
	});

	test('returns [] when the container is already gone', async () => {
		g.__codebayDocker = Promise.resolve({
			getContainer: () => ({
				inspect: async () => {
					throw httpErr(404);
				}
			})
		});
		expect(await builtImages('c1')).toEqual([]);
	});
});

describe('removeImages', () => {
	afterEach(() => {
		g.__codebayDocker = undefined;
	});

	test('removes every ref, treating an already-absent image as done', async () => {
		const removed = fakeImages({ removeFails: { gone: 404 } });
		expect(await removeImages(['a', 'gone', 'b'])).toEqual([]);
		expect(removed).toEqual(['a', 'b']);
	});

	test('keeps an image still in use (409) and reports why, without throwing', async () => {
		const removed = fakeImages({ removeFails: { shared: 409 } });
		const kept = await removeImages(['shared', 'mine']);
		expect(removed).toEqual(['mine']);
		expect(kept).toEqual(['shared: http 409']);
	});

	test('reports a daemon that is unreachable instead of throwing', async () => {
		g.__codebayDocker = Promise.reject(new Error('connect ECONNREFUSED'));
		expect(await removeImages(['a'])).toEqual(['a: connect ECONNREFUSED']);
	});

	test('untaggedOnly spares an image a tag still points at', async () => {
		const removed = fakeImages({
			images: {
				'sha256:old': { Id: 'sha256:old', RepoTags: [] },
				'sha256:legacy': { Id: 'sha256:legacy', RepoTags: ['<none>:<none>'] },
				'sha256:reused': { Id: 'sha256:reused', RepoTags: [`${BASE}-features:latest`] }
			}
		});
		const ids = ['sha256:old', 'sha256:legacy', 'sha256:reused'];
		expect(await removeImages(ids, { untaggedOnly: true })).toEqual([]);
		expect(removed).toEqual(['sha256:old', 'sha256:legacy']);
	});
});
