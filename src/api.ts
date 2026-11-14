interface ApiErrorBody {
	error?: { message: string };
}

/** A forged cross-site request can't set a custom header, which is what the CSRF guard leans on. */
const APP_REQUEST_HEADER = 'X-Codebay-Request';

/** Throws on a non-ok response, so callers can treat a return value as success. */
export async function apiFetch<T = unknown>(
	url: string,
	init?: RequestInit,
	fallbackMessage = 'Request failed'
): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers as Record<string, string> | undefined),
			[APP_REQUEST_HEADER]: '1'
		}
	});
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
		throw new Error(data?.error?.message ?? fallbackMessage);
	}
	return (await res.json().catch(() => ({}))) as T;
}

export function apiPost<T = unknown>(
	url: string,
	body?: unknown,
	fallbackMessage?: string
): Promise<T> {
	return apiJson<T>('POST', url, body, fallbackMessage);
}

export function apiDelete<T = unknown>(
	url: string,
	body?: unknown,
	fallbackMessage?: string
): Promise<T> {
	return apiJson<T>('DELETE', url, body, fallbackMessage);
}

function apiJson<T>(
	method: 'POST' | 'DELETE',
	url: string,
	body: unknown,
	fallbackMessage?: string
): Promise<T> {
	return apiFetch<T>(
		url,
		body === undefined
			? { method }
			: {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				},
		fallbackMessage
	);
}
