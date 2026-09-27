import { Mochi, apiError, type MochiRouteValue } from 'mochi-framework';
import {
	MCP_PATH,
	MCP_WAIT_PATH,
	mcpAuthOk,
	mcpEnabled,
	waitSigOk
} from '../lib/mcp-auth.server.ts';
import { MAX_WAIT_MS, assertWaitTargets, waitFor } from '../lib/waits.server.ts';
import { PUBLIC_ORIGIN, PUBLIC_ORIGIN_PINNED } from '../lib/config.server.ts';
import { mcpTransport } from './server.server.ts';
import { waitPayload } from './payloads.server.ts';

function unauthorized(): Response {
	return new Response('Unauthorized', {
		status: 401,
		headers: { 'WWW-Authenticate': 'Bearer realm="Codebay MCP"' }
	});
}

/** Well inside Bun's `idleTimeout` (120s in `index.ts`), which would otherwise cut a quiet wait. */
const HEARTBEAT_MS = 20_000;

/**
 * Interleaves SSE comments into a quiet event stream. Without them Bun's idle timeout closes a
 * blocked tool call's response, and the standalone GET stream the channel pushes ride on, after
 * two silent minutes; a client's hang-up still cancels the inner stream, which is what aborts the
 * tool call's waiter.
 */
function withKeepalive(response: Response): Response {
	if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
		return response;
	}
	const reader = response.body.getReader();
	const ping = new TextEncoder().encode(': keepalive\n\n');
	let timer: ReturnType<typeof setInterval> | undefined;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			timer = setInterval(() => {
				try {
					controller.enqueue(ping);
				} catch {
					clearInterval(timer);
				}
			}, HEARTBEAT_MS);
		},
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				clearInterval(timer);
				controller.close();
			} else {
				controller.enqueue(value);
			}
		},
		cancel(reason) {
			clearInterval(timer);
			return reader.cancel(reason);
		}
	});
	return new Response(body, { status: response.status, headers: response.headers });
}

/** The origin this client used, unless the operator pinned one (e.g. behind a TLS proxy). */
const clientOrigin = (request: Request) =>
	PUBLIC_ORIGIN_PINNED ? PUBLIC_ORIGIN : new URL(request.url).origin;

const idList = (value: string | null) =>
	(value ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

/**
 * The completion long-poll a shell `curl` blocks on. The body opens with whitespace heartbeats and
 * ends with one JSON document, so the output parses as-is and a retried request (after a manager
 * restart dropped the first) still yields clean JSON.
 */
function waitResponse(request: Request): Response {
	const url = new URL(request.url);
	const runs = idList(url.searchParams.get('runs'));
	const sandboxes = idList(url.searchParams.get('sandboxes'));
	if (!mcpAuthOk(request) && !waitSigOk(url.searchParams.get('sig'), runs, sandboxes)) {
		return unauthorized();
	}
	try {
		assertWaitTargets({ runs, sandboxes });
	} catch (err) {
		return apiError(400, (err as Error).message);
	}
	const seconds = Number(url.searchParams.get('timeout'));
	const timeoutMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : MAX_WAIT_MS;
	const mode = url.searchParams.get('mode') === 'any' ? 'any' : 'all';

	const hangup = new AbortController();
	const onRequestAbort = () => hangup.abort();
	request.signal.addEventListener('abort', onRequestAbort, { once: true });
	const encoder = new TextEncoder();
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode('\n'));
				} catch {
					clearInterval(heartbeat);
				}
			}, HEARTBEAT_MS);
			void waitFor({ runs, sandboxes }, { mode, timeoutMs, signal: hangup.signal })
				.then((outcome) => {
					if (outcome.aborted) return;
					controller.enqueue(encoder.encode(JSON.stringify(waitPayload(outcome), null, 2) + '\n'));
					controller.close();
				})
				.catch((err: unknown) => controller.error(err))
				.finally(() => {
					clearInterval(heartbeat);
					request.signal.removeEventListener('abort', onRequestAbort);
				});
		},
		// Bun cancels the body when the client hangs up; the waiter's own cleanup does the rest.
		cancel() {
			clearInterval(heartbeat);
			hangup.abort();
		}
	});
	return new Response(body, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Accel-Buffering': 'no'
		}
	});
}

/**
 * Mounted at `/mcp` rather than under `/api/` on purpose: `basicAuth` 403s every mutating `/api/`
 * request without the `x-codebay-request` header, which no MCP client sends. The path is exempt
 * from the Basic Auth gate and the CSRF filter, and authenticates by bearer token instead — the
 * same trade the container bridge makes.
 */
export const mcpRoutes: Record<string, MochiRouteValue> = {
	[MCP_PATH]: Mochi.api(async ({ request }) => {
		// A 404 while disabled, so an install that never opted in looks like it has no MCP at all.
		if (!mcpEnabled()) return apiError(404, 'Not Found');
		if (!mcpAuthOk(request)) return unauthorized();
		const response = await mcpTransport().respond(request, { origin: clientOrigin(request) });
		return response ? withKeepalive(response) : apiError(404, 'Not Found');
	}),
	[MCP_WAIT_PATH]: Mochi.api(({ request }) => {
		if (!mcpEnabled()) return apiError(404, 'Not Found');
		if (request.method !== 'GET') return apiError(405, 'Method Not Allowed');
		return waitResponse(request);
	})
};
