import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_SERVER_PORT, TTYD_PORT } from './config.server.ts';
import { getOption } from './db.server.ts';
import { stripJsonc } from './jsonc.ts';
import { registerSecretValue } from './secrets.server.ts';
import { parseCustomEnvVars } from '../container-injections/custom-env-vars.ts';

/** Shipped by the project itself, so it sits at the workspace root rather than in `.devcontainer/`. */
export const PROJECT_CONFIG_FILE = 'codebay.json';

/** Each maps to the *name* of a host-side variable, never to a value. */
export type OverrideKey = 'claudeCodeToken' | 'githubToken' | 'gitUserName' | 'gitUserEmail';

export const OVERRIDE_KEYS: OverrideKey[] = [
	'claudeCodeToken',
	'githubToken',
	'gitUserName',
	'gitUserEmail'
];

export interface ProjectPort {
	containerPort: number;
	/** null means allocate from the usual host-port pool. */
	hostPort: number | null;
	name: string;
}

export interface ProjectConfig {
	overrides: Partial<Record<OverrideKey, string>>;
	ports: ProjectPort[];
	/** Non-fatal complaints; the boot log echoes them so a typo isn't silent. */
	warnings: string[];
}

/** Same shape the custom-env-vars setting enforces, since these name the very same variables. */
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** It lands in a chip and a `title` attribute, so collapse it to one short plain line. */
const MAX_NAME_LEN = 32;

function emptyConfig(): ProjectConfig {
	return { overrides: {}, ports: [], warnings: [] };
}

function sanitizePortName(raw: string): string {
	return [...raw]
		.map((ch) => {
			const code = ch.codePointAt(0)!;
			return code < 0x20 || code === 0x7f ? ' ' : ch;
		})
		.join('')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_NAME_LEN);
}

function parsePort(raw: string): number | null {
	if (!/^\d{1,5}$/.test(raw)) return null;
	const port = Number.parseInt(raw, 10);
	return port >= 1 && port <= 65535 ? port : null;
}

function parseOverrides(value: unknown, config: ProjectConfig): void {
	if (value === undefined) return;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		config.warnings.push('"overrides" must be an object; ignored');
		return;
	}
	for (const [key, varName] of Object.entries(value as Record<string, unknown>)) {
		if (!OVERRIDE_KEYS.includes(key as OverrideKey)) {
			config.warnings.push(`unknown override "${key}" (expected ${OVERRIDE_KEYS.join(', ')})`);
			continue;
		}
		if (typeof varName !== 'string' || !VAR_NAME_RE.test(varName)) {
			config.warnings.push(`override "${key}" must name an environment variable; ignored`);
			continue;
		}
		config.overrides[key as OverrideKey] = varName;
	}
}

function parsePorts(value: unknown, config: ProjectConfig): void {
	if (value === undefined) return;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		config.warnings.push('"ports" must be an object; ignored');
		return;
	}
	const byContainerPort = new Map<number, ProjectPort>();
	for (const [key, name] of Object.entries(value as Record<string, unknown>)) {
		// A bare key is a container port; `host:container` pins the host side, as in devcontainer.json.
		const parts = key.split(':');
		if (parts.length > 2) {
			config.warnings.push(`port "${key}" must be "<port>" or "<host>:<container>"; ignored`);
			continue;
		}
		const containerPort = parsePort(parts[parts.length - 1]!.trim());
		const hostPort = parts.length === 2 ? parsePort(parts[0]!.trim()) : null;
		if (containerPort === null || (parts.length === 2 && hostPort === null)) {
			config.warnings.push(`port "${key}" is not a valid port number; ignored`);
			continue;
		}
		// Publishing either would put the unauthenticated editor/terminal outside the proxy's auth gate.
		if (containerPort === CODE_SERVER_PORT || containerPort === TTYD_PORT) {
			config.warnings.push(`port ${containerPort} is reserved by Codebay; ignored`);
			continue;
		}
		if (typeof name !== 'string' || !sanitizePortName(name)) {
			config.warnings.push(`port "${key}" needs a non-empty name; ignored`);
			continue;
		}
		if (byContainerPort.has(containerPort)) {
			config.warnings.push(`port ${containerPort} is named more than once; the last one wins`);
		}
		byContainerPort.set(containerPort, {
			containerPort,
			hostPort,
			name: sanitizePortName(name)
		});
	}
	config.ports = [...byContainerPort.values()].sort((a, b) => a.containerPort - b.containerPort);
}

/** Never throws — a broken file degrades to "no project config" plus a warning in the boot log. */
export function parseProjectConfig(raw: string): ProjectConfig {
	const config = emptyConfig();
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonc(raw));
	} catch (err) {
		config.warnings.push(`could not be parsed: ${(err as Error).message}`);
		return config;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		config.warnings.push('must contain a JSON object');
		return config;
	}
	const root = parsed as Record<string, unknown>;
	parseOverrides(root.overrides, config);
	parsePorts(root.ports, config);
	return config;
}

export async function readProjectConfig(workspaceDir: string): Promise<ProjectConfig> {
	const file = join(workspaceDir, PROJECT_CONFIG_FILE);
	if (!existsSync(file)) return emptyConfig();
	try {
		return parseProjectConfig(await readFile(file, 'utf8'));
	} catch (err) {
		const config = emptyConfig();
		config.warnings.push(`could not be read: ${(err as Error).message}`);
		return config;
	}
}

/**
 * Settings first, then this process's own environment — the same order that lets a user shadow a
 * host variable from the UI without restarting the manager.
 */
export function resolveHostVar(name: string): string | null {
	if (getOption('custom_env_vars_enabled') === '1') {
		const match = parseCustomEnvVars(getOption('custom_env_vars')).find((v) => v.name === name);
		if (match?.value) return match.value;
	}
	return Bun.env[name] || null;
}

/**
 * `null` whenever the repo declares no override or the variable it names is unset, so every caller
 * falls straight through to its normal host discovery.
 */
export async function projectOverride(
	workspaceDir: string | null | undefined,
	key: OverrideKey
): Promise<{ value: string; varName: string } | null> {
	if (!workspaceDir) return null;
	const varName = (await readProjectConfig(workspaceDir)).overrides[key];
	if (!varName) return null;
	const value = resolveHostVar(varName);
	if (!value) return null;
	registerSecretValue(value);
	return { value, varName };
}

/** The `source` string every overridden injection reports, so the boot log says which name won. */
export function overrideSource(varName: string): string {
	return `${PROJECT_CONFIG_FILE} — ${varName}`;
}
