import Docker from 'dockerode';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

/** Docker Desktop for Windows exposes no Unix socket; its daemon listens on a named pipe. */
const DEFAULT_DOCKER_SOCKET =
	process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';

async function resolveDocker(): Promise<Docker> {
	const host = DOCKER_HOST || (await dockerContextHost()) || '';
	return new Docker(host ? parseDockerHost(host) : { socketPath: DEFAULT_DOCKER_SOCKET });
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
	// homedir(), not $HOME, which Windows leaves unset — that would make this cwd-relative.
	const dir = process.env.DOCKER_CERT_PATH?.trim() || join(homedir(), '.docker');
	const read = (name: string): Buffer | undefined => {
		try {
			return readFileSync(join(dir, name));
		} catch {
			return undefined;
		}
	};
	return { ca: read('ca.pem'), cert: read('cert.pem'), key: read('key.pem') };
}

/** dockerode takes a Windows named pipe as a `socketPath`, exactly like a Unix socket. */
function parseDockerHost(host: string): Docker.DockerOptions {
	for (const scheme of ['unix://', 'npipe://']) {
		if (host.startsWith(scheme)) return { socketPath: host.slice(scheme.length) };
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
