<script lang="ts">
	import { ideUrl, type Instance, type Preflight } from '../types.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import DashboardView from './DashboardView.svelte';
	import IdeBar from './IdeBar.svelte';
	import IdeLoader from './IdeLoader.svelte';
	import { playChime, unlockAudio } from '../sound.ts';
	import { liveStream } from '../live.ts';
	import { apiPost } from '../api.ts';

	// `initialPath` is the URL the document was served for; `snapshot` is the
	// reconciled instance list at render time, used to seed the live state so both
	// the dashboard grid and the IDE iframe render without a loading flash.
	let {
		preflight,
		initialPath,
		snapshot
	}: { preflight: Preflight; initialPath: string; snapshot: Instance[] } = $props();

	// --- Shared live state (single SSE subscription, used by both views) ----------
	// Seeding from the SSR snapshot is intentional — the live stream overwrites it.
	// svelte-ignore state_referenced_locally
	let instances = $state<Instance[]>(snapshot);
	// Live preflight: seeded from the SSR prop, then kept current by 'preflight'
	// stream events (docker + CLI). Auth is preserved — it's only probed at SSR.
	// svelte-ignore state_referenced_locally
	let livePreflight = $state<Preflight>(preflight);
	// svelte-ignore state_referenced_locally
	let loaded = $state(snapshot.length > 0);
	const running = $derived(instances.filter((i) => i.status === 'running'));

	// Live attention signal per instance, raised by the in-container Claude hook:
	// 'done' (task finished) pulses green, 'waiting' (needs input) pulses amber.
	let attention = $state<Record<string, 'done' | 'waiting' | null>>(
		Object.fromEntries(snapshot.map((i) => [i.id, i.attention]))
	);

	// --- Client-side router (Dashboard ⇄ IDE only) --------------------------------
	// Mochi has no client router; we keep a reactive path and intercept the handful
	// of in-app links so navigating between `/` and `/ide/:id` never reloads the
	// document — keeping the code-server iframes mounted across the transition.
	// svelte-ignore state_referenced_locally
	let path = $state(initialPath);
	const onIde = $derived(path.startsWith('/ide'));
	const requestedId = $derived(path.startsWith('/ide/') ? path.slice('/ide/'.length) : '');
	// Default to the requested instance when running, else the first running one
	// (e.g. arriving for an instance that has since stopped). Empty on the dashboard.
	const active = $derived(
		onIde ? (running.some((i) => i.id === requestedId) ? requestedId : (running[0]?.id ?? '')) : ''
	);

	function navigate(to: string) {
		if (to === path) return;
		history.pushState({}, '', to);
		path = to;
	}

	// Intercept plain left-clicks on in-app links to `/` and `/ide/*`. Modifier
	// clicks, new-tab targets, downloads, and other routes (Settings, Details) fall
	// through to a normal full navigation.
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

	// Reflect browser Back/Forward into the reactive path.
	$effect(() => {
		function onPop() {
			path = location.pathname;
		}
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	});

	// --- IDE iframe lifecycle -----------------------------------------------------
	// Instances whose iframe has been mounted at least once. We mount an IDE lazily
	// on first activation, then keep it mounted (hidden via CSS) so its
	// editor/connection survive tab switches and trips back to the dashboard.
	const visited = new SvelteSet<string>();
	$effect(() => {
		if (active) visited.add(active);
	});

	// Instances whose iframe has fired its `load` event. Until then we overlay a
	// loader so switching to a freshly-mounted IDE shows a readout, not blank white.
	const loadedFrames = new SvelteSet<string>();

	// Keep the document title in step with the focused instance.
	$effect(() => {
		const inst = running.find((i) => i.id === active);
		document.title =
			onIde && inst ? `${inst.name} — Devcontainers Manager` : 'Devcontainers Manager';
	});

	// Unlock/resume the chime's audio context on the first interaction with the page
	// (browsers block audio until the page has been interacted with).
	$effect(() => {
		window.addEventListener('pointerdown', unlockAudio);
		window.addEventListener('keydown', unlockAudio);
		return () => {
			window.removeEventListener('pointerdown', unlockAudio);
			window.removeEventListener('keydown', unlockAudio);
		};
	});

	// Central live stream: drives both views and the attention chime, chiming when
	// a non-focused tab newly raises (or changes) its signal. Only `instances`
	// events matter here; `health` events are for the instance detail view.
	$effect(() => {
		// Skip the first frame after each (re)connect so the server's re-seed of
		// the full list is treated as the baseline rather than a live change —
		// otherwise a reconnect would replay chimes for anything that shifted while
		// we were disconnected.
		let primed = false;
		return liveStream(
			(msg) => {
				if (msg.type === 'preflight') {
					livePreflight = { ...livePreflight, docker: msg.data.docker, cli: msg.data.cli };
					return;
				}
				if (msg.type !== 'instances') return;
				const next = msg.data;
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

	// The focused tab shouldn't pulse: dismiss its signal server-side (for all
	// viewers) once the user is actually *looking* at it. Gated on document
	// visibility so an IDE tab sitting in a background browser tab doesn't wipe the
	// signal out from under the dashboard card. Re-checks when the tab regains focus.
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
		<IdeBar {running} {active} {attention} onselect={(id) => navigate(`/ide/${id}`)} />
	{:else}
		<DashboardView preflight={livePreflight} {instances} {loaded} />
	{/if}

	<!-- Persistent panes: always mounted so iframes survive navigation; hidden on
       the dashboard. Empty-state message only shows on the IDE route. -->
	<div class="panes" class:hidden={!onIde}>
		{#each running as inst (inst.id)}
			{#if visited.has(inst.id)}
				<div class="pane" class:active={inst.id === active}>
					<iframe src={ideUrl(inst)} title={inst.name} onload={() => loadedFrames.add(inst.id)}
					></iframe>
					{#if !loadedFrames.has(inst.id)}
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

<style>
	/* On the IDE route the app is a fixed-height column (bar + panes fill the
     viewport); on the dashboard it's normal document flow that scrolls. */
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
