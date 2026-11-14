import { apiFetch } from '../api.ts';

export interface UploadedFile {
	name: string;
	hostPath: string;
	containerPath: string;
	bytes: number;
}

/** Unknown MIME subtype → `.bin`, so a pasted image never round-trips with no extension at all. */
function extFor(mimeType: string): string {
	const subtype = mimeType.split('/')[1];
	return subtype && /^[a-z0-9.+-]+$/i.test(subtype) ? subtype : 'bin';
}

/** Files from a drop or a paste; pasted images arrive nameless, so they get a timestamped one. */
export function filesFrom(dt: DataTransfer | null): File[] {
	if (!dt) return [];
	return [...dt.files].map((f) =>
		f.name ? f : new File([f], `pasted-${Date.now()}.${extFor(f.type)}`, { type: f.type })
	);
}

export async function uploadFile(id: string, file: File): Promise<UploadedFile> {
	const q = new URLSearchParams({ name: file.name });
	const { file: saved } = await apiFetch<{ file: UploadedFile }>(
		`/api/instances/${id}/upload?${q}`,
		{ method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
		'Upload failed'
	);
	return saved;
}
