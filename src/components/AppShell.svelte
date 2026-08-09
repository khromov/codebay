<script lang="ts">
	import { ideUrl, type Instance, type InstanceFilter, type Preflight } from '../types.ts';
	import { findAvatar, type AvatarArt } from '../avatars/index.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import DashboardView from './DashboardView.svelte';
	import IdeBar from './IdeBar.svelte';
	import IdeLoader from './IdeLoader.svelte';
	import TerminalPane from './TerminalPane.svelte';
	import { playChime, unlockAudio } from '../sound.ts';
	import { liveStream } from '../live.ts';
	import { apiPost } from '../api.ts';
	import toast, { Toaster } from 'svelte-french-toast';

	// `snapshot` seeds the live state so neither view renders a loading flash first.
	let {
		preflight,
		initialPath,
		snapshot,
		pet,
		filter
	}: {
		preflight: Preflight;
		initialPath: string;
		snapshot: Instance[];
		pet?: AvatarArt;
		filter: InstanceFilter;
	} = $props();

	// Seeding from the SSR snapshot is intentional — the live stream overwrites it.
	// svelte-ignore state_referenced_locally
	let instances = $state<Instance[]>(snapshot);
	// Auth is preserved across stream updates because it's only ever probed at SSR.
	// svelte-ignore state_referenced_locally
	let livePreflight = $state<Preflight>(preflight);
	// Seeded from SSR, then updated live so changing the pet in settings swaps the header without a reload.
	// svelte-ignore state_referenced_locally
	let livePet = $state<AvatarArt | undefined>(pet);
	// Owned here (not in DashboardView) so it survives the dashboard↔IDE tab switches that remount the view.
	// svelte-ignore state_referenced_locally
	let liveFilter = $state<InstanceFilter>(filter);
	// svelte-ignore state_referenced_locally
	let loaded = $state(snapshot.length > 0);
	const running = $derived(instances.filter((i) => i.status === 'running'));

	let attention = $state<Record<string, 'done' | 'waiting' | null>>(
		Object.fromEntries(snapshot.map((i) => [i.id, i.attention]))
	);

	let editingId = $state<string | null>(null);
	let editingName = $state('');

	function startRename(instance: Instance) {
		editingId = instance.id;
		editingName = instance.name;
	}

	function cancelRename() {
		editingId = null;
		editingName = '';
	}

	async function commitRename(id: string) {
		const name = editingName.trim();
		const original = instances.find((i) => i.id === id)?.name;
		// Nothing to do on an empty or unchanged name — just close the editor.
		if (!name || name === original) {
			cancelRename();
			return;
		}
		cancelRename();
		try {
			await apiPost(`/api/instances/${id}/rename`, { name }, 'Failed to rename');
			// The live stream reflects the new name.
		} catch (err) {
			toast.error((err as Error).message);
		}
	}

	// Optimistic local update + best-effort persist; the broadcast echo reconciles every open tab.
	function setFilter(v: InstanceFilter) {
		liveFilter = v;
		void apiPost('/api/settings/filter', { value: v }).catch(() => {
			/* best-effort — the in-memory value already reflects the choice */
		});
	}

	// Mochi has no client router, and a document reload would tear down the code-server iframes.
	// svelte-ignore state_referenced_locally
	let path = $state(initialPath);
	const onIde = $derived(path.startsWith('/ide'));
	const requestedId = $derived(path.startsWith('/ide/') ? path.slice('/ide/'.length) : '');
	// Falls back to the first running instance, for arriving at one that has since stopped.
	const active = $derived(
		onIde ? (running.some((i) => i.id === requestedId) ? requestedId : (running[0]?.id ?? '')) : ''
	);

	function navigate(to: string) {
		if (to === path) return;
		history.pushState({}, '', to);
		path = to;
	}

	// Modifier clicks, new-tab targets, and other routes must fall through to a full navigation.
	$effect(() => {
		function onClick(e: MouseEvent) {
			if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
				return;
			const anchor = (e.target as Element | null)?.closest?.('a');
			if (!anchor) return;
			const href = anchor.getAttribute('href');
			if (!href || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
			const url = new URL(href, location.href);
			if (url.origin !== location.origin) return;
			if (url.pathname === '/' || url.pathname.startsWith('/ide/')) {
				e.preventDefault();
				navigate(url.pathname);
			}
		}
		document.addEventListener('click', onClick);
		return () => document.removeEventListener('click', onClick);
	});

	$effect(() => {
		function onPop() {
			path = location.pathname;
		}
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	});

	// Native unsaved-changes guard: a reload/close/external-nav tears down the code-server
	// iframes and loses in-editor state. In-app /↔/ide transitions are pushState (no unload)
	// and Settings/Details links open in new tabs, so this only fires on a true teardown.
	$effect(() => {
		if (running.length === 0) return;
		function onBeforeUnload(e: BeforeUnloadEvent) {
			e.preventDefault();
			e.returnValue = '';
		}
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	// Mounted lazily, then kept mounted (hidden via CSS) so the editor survives tab switches.
	const visited = new SvelteSet<string>();
	$effect(() => {
		if (active) visited.add(active);
	});

	// Until `load` fires, a loader overlays the pane so a fresh IDE isn't blank white.
	const loadedFrames = new SvelteSet<string>();

	// `running` only means the container is up; mounting before code-server binds its
	// port renders the proxy's 503. Sticky, so a later probe blip can't tear down a live editor.
	const everReady = new SvelteSet<string>();

	// Kept separate from `everReady` so that stays an honest record of what the probe reported.
	const forced = new SvelteSet<string>();
	const mountable = (id: string) => everReady.has(id) || forced.has(id);

	const STALLED_AFTER_MS = 10_000;

	$effect(() => {
		const inst = running.find((i) => i.id === active);
		document.title = onIde && inst ? `${inst.name} — Codebay` : 'Codebay';
	});

	// Browsers block audio until the page has been interacted with.
	$effect(() => {
		window.addEventListener('pointerdown', unlockAudio);
		window.addEventListener('keydown', unlockAudio);
		return () => {
			window.removeEventListener('pointerdown', unlockAudio);
			window.removeEventListener('keydown', unlockAudio);
		};
	});

	$effect(() => {
		// The re-seed after a reconnect is a baseline, not a change — otherwise it replays chimes.
		let primed = false;
		return liveStream(
			(msg) => {
				if (msg.type === 'preflight') {
					livePreflight = { ...livePreflight, docker: msg.data.docker, cli: msg.data.cli };
					return;
				}
				if (msg.type === 'pet') {
					livePet = findAvatar(msg.data.name ?? undefined);
					return;
				}
				if (msg.type === 'filter') {
					liveFilter = msg.data.value;
					return;
				}
				if (msg.type === 'health') {
					// A tick in flight when a rebuild starts probes the *old* container and
					// reports it accessible, which would mount the iframe against the replacement too early.
					const inst = instances.find((i) => i.id === msg.data.id);
					if (msg.data.health.codeServerAccessible && inst?.status === 'running')
						everReady.add(msg.data.id);
					return;
				}
				if (msg.type !== 'instances') return;
				const next = msg.data;
				// Re-arm the gate: a replaced container must prove code-server is up again.
				const live = new Set(next.filter((i) => i.status === 'running').map((i) => i.id));
				for (const id of [...everReady]) if (!live.has(id)) everReady.delete(id);
				for (const id of [...forced]) if (!live.has(id)) forced.delete(id);
				for (const id of [...loadedFrames]) if (!live.has(id)) loadedFrames.delete(id);
				const nextAttention: Record<string, 'done' | 'waiting' | null> = {};
				for (const inst of next) nextAttention[inst.id] = inst.attention;
				if (primed) {
					for (const id in nextAttention) {
						const state = nextAttention[id];
						if (state && state !== attention[id]) {
							if (id === active) {
								console.log(
									`[chime] attention id=${id} state=${state} — skipped (tab is active/focused)`
								);
							} else {
								console.log(`[chime] attention id=${id} state=${state} → playChime`);
								playChime(state);
							}
						}
					}
				} else {
					console.log('[chime] first frame after (re)connect — baselining, no chimes');
				}
				primed = true;
				instances = next;
				attention = nextAttention;
				loaded = true;
			},
			() => {
				primed = false;
			}
		);
	});

	// Gated on document visibility, or a background browser tab would wipe the
	// signal out from under the dashboard card.
	$effect(() => {
		if (!active || !attention[active]) return;
		const dismiss = () => {
			if (document.visibilityState === 'visible') {
				void apiPost(`/api/instances/${active}/attention/clear`).catch(() => {
					/* best-effort — the next visibility change retries */
				});
			}
		};
		dismiss();
		document.addEventListener('visibilitychange', dismiss);
		return () => document.removeEventListener('visibilitychange', dismiss);
	});
</script>

<div class="app" class:ide={onIde}>
	{#if onIde}
		<IdeBar
			{running}
			{active}
			{attention}
			{editingId}
			bind:editingName
			onselect={(id) => navigate(`/ide/${id}`)}
			onstartrename={startRename}
			oncommitrename={commitRename}
			oncancelrename={cancelRename}
		/>
	{:else}
		<DashboardView
			preflight={livePreflight}
			{instances}
			{loaded}
			pet={livePet}
			filter={liveFilter}
			onFilter={setFilter}
		/>
	{/if}

	<!-- Always mounted, only hidden, so the iframes survive navigation. -->
	<div class="panes" class:hidden={!onIde}>
		{#each running as inst (inst.id)}
			{#if visited.has(inst.id)}
				<div class="pane" class:active={inst.id === active}>
					{#if mountable(inst.id)}
						{#if inst.mode === 'terminal'}
							<TerminalPane id={inst.id} active={inst.id === active} />
						{:else}
							<iframe src={ideUrl(inst)} title={inst.name} onload={() => loadedFrames.add(inst.id)}
							></iframe>
						{/if}
					{/if}
					<!-- Two distinct waits: the health probe is unbounded and gets the override, the
					     iframe's own `load` is bounded and gets a plain loader. The terminal has no
					     `load` event, so once it's mountable its own "connecting…" covers the gap. -->
					{#if !mountable(inst.id)}
						<IdeLoader stalledAfterMs={STALLED_AFTER_MS} onoverride={() => forced.add(inst.id)} />
					{:else if inst.mode !== 'terminal' && !loadedFrames.has(inst.id)}
						<IdeLoader />
					{/if}
				</div>
			{/if}
		{/each}
		{#if onIde && running.length === 0}
			<div class="empty">No running instances.</div>
		{/if}
	</div>
</div>

<!-- Hoisted out of DashboardView so IDE-route toasts have somewhere to render too. -->
<Toaster
	toastOptions={{
		style:
			'border:1px solid var(--ink); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--ink); font-family:var(--font-mono); font-size:13px;'
	}}
/>

<style>
	/* The IDE route fills the viewport; the dashboard stays in normal scrolling flow. */
	.app.ide {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.panes {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.panes.hidden {
		display: none;
	}
	.pane {
		position: absolute;
		inset: 0;
	}
	.pane:not(.active) {
		display: none;
	}
	iframe {
		width: 100%;
		height: 100%;
		border: 0;
		display: block;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 13px;
	}
</style>
