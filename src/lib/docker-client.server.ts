import Docker from 'dockerode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCKER_HOST, dockerEnv } from './config.server.ts';
import { spawnCapture } from './spawn.server.ts';

/** Pinned to globalThis so dev-mode hot reload doesn't reopen connections. */
const g = globalThis as unknown as { __codebayDocker?: Promise<Docker> };

export function getDocker(): Promise<Docker> {
	return (g.__codebayDocker ??= resolveDocker());
}

/** Without this the pinned client would target a dead socket for the whole process lifetime. */
export function resetDocker(): void {
	g.__codebayDocker = undefined;
}

async function resolveDocker(): Promise<Docker> {
	const host = DOCKER_HOST || (await dockerContextHost()) || '';
	return new Docker(host ? parseDockerHost(host) : { socketPath: '/var/run/docker.sock' });
}

/** dockerode ignores `docker context`, but the devcontainer CLI honors it — so read it here. */
async function dockerContextHost(): Promise<string> {
	return (
		(await spawnCapture(
			['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
			{ env: dockerEnv() }
		)) ?? ''
	);
}

/** Missing files yield undefined so the connection fails with a clear TLS error, not here. */
function tlsMaterials(): { ca?: Buffer; cert?: Buffer; key?: Buffer } {
	const dir = process.env.DOCKER_CERT_PATH?.trim() || join(process.env.HOME ?? '', '.docker');
	const read = (name: string): Buffer | undefined => {
		try {
			return readFileSync(join(dir, name));
		} catch {
			return undefined;
		}
	};
	return { ca: read('ca.pem'), cert: read('cert.pem'), key: read('key.pem') };
}

/** Windows `npipe://` is unsupported — this app runs on macOS/Linux. */
function parseDockerHost(host: string): Docker.DockerOptions {
	if (host.startsWith('unix://')) {
		return { socketPath: host.slice('unix://'.length) };
	}
	const tls = (process.env.DOCKER_TLS_VERIFY ?? '') !== '';
	const url = new URL(host.includes('://') ? host : `tcp://${host}`);
	const base: Docker.DockerOptions = {
		host: url.hostname,
		port: url.port ? Number.parseInt(url.port, 10) : tls ? 2376 : 2375,
		protocol: tls ? 'https' : 'http'
	};
	// A TLS daemon needs the client cert/key (and CA) or the handshake fails.
	return tls ? { ...base, ...tlsMaterials() } : base;
}
