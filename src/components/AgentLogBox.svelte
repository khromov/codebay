<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import Terminal from '@lucide/svelte/icons/terminal';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { apiFetch } from '../api.ts';
	import type { RunTimelineEntry } from '../lib/agent-run-stream.ts';
	import type { AgentRunStatus } from '../types.ts';

	interface AgentRun {
		id: string;
		status: AgentRunStatus;
		prompt: string;
		result: string | null;
		error: string | null;
		is_error: boolean;
		last_activity: string | null;
		num_turns: number | null;
		cost_usd: number | null;
		duration_ms: number | null;
		created_at: number;
		started_at: number | null;
		finished_at: number | null;
	}

	let {
		id,
		/** Bumped by the parent on every `run` stream frame, which is what drives live refresh. */
		bump = 0
	}: { id: string; bump?: number } = $props();

	let runs = $state<AgentRun[]>([]);
	let timelines = $state<Record<string, RunTimelineEntry[]>>({});
	/** Expanded run ids. An array rather than a Set so Svelte tracks the changes. */
	let open = $state<string[]>([]);
	/** The newest run already reacted to, so one starting later can take the spotlight exactly once. */
	let newest: string | null = null;
	let loaded = $state(false);
	let error = $state<string | null>(null);

	const isOpen = (runId: string) => open.includes(runId);

	async function load() {
		try {
			const q = open.length ? `?run_ids=${encodeURIComponent(open.join(','))}` : '';
			const data = await apiFetch<{
				runs: AgentRun[];
				timelines: Record<string, RunTimelineEntry[]>;
			}>(`/api/instances/${id}/agent-log${q}`, undefined, 'Could not load the agent log');

			runs = data.runs;
			timelines = { ...timelines, ...data.timelines };

			// A run that starts while the panel is open takes over: collapse the rest and expand it,
			// so the box you are looking at is always the one currently doing something.
			const top = data.runs[0]?.id ?? null;
			if (top && top !== newest) {
				newest = top;
				open = [top];
			}
			error = null;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			loaded = true;
		}
	}

	$effect(() => {
		// `bump` must be read as a real value. A bare `void bump;` is dead code the compiler drops,
		// which leaves this effect with no dependency at all — the panel then renders the state it
		// mounted with and never updates again, which is exactly what shipped first time round.
		if (bump < 0) return;
		void load();
	});

	function toggle(runId: string) {
		const opening = !isOpen(runId);
		open = opening ? [...open, runId] : open.filter((r) => r !== runId);
		// Expanding a box whose timeline the server hasn't sent yet needs a fetch to fill it.
		if (opening && !timelines[runId]) void load();
	}

	const ICONS = { tool: Terminal, text: MessageSquare, retry: RefreshCw, result: CircleCheck };

	const isLive = (run: AgentRun) => run.status === 'running' || run.status === 'queued';

	function when(run: AgentRun): string {
		return new Date(run.created_at).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function meta(run: AgentRun): string {
		const bits: string[] = [];
		if (run.num_turns != null) bits.push(`${run.num_turns} turns`);
		if (run.cost_usd != null) bits.push(`$${run.cost_usd.toFixed(4)}`);
		if (run.duration_ms != null) bits.push(`${(run.duration_ms / 1000).toFixed(1)}s`);
		return bits.join(' · ');
	}

	/** The one-line gist on a collapsed box, so the strip is worth scanning shut. */
	function peek(run: AgentRun): string {
		if (run.status === 'queued') return 'Queued';
		if (isLive(run)) return (run.last_activity ?? 'Working…').replace(/\s+/g, ' ').trim();
		return (run.error ?? run.result ?? run.prompt).replace(/\s+/g, ' ').trim();
	}
</script>

{#if loaded && runs.length > 0}
	<section class="agentwrap panel">
		<div class="agent-bar panel-bar">
			<span><Bot size={14} /> Agent log</span>
			<span class="count">{runs.length} run{runs.length === 1 ? '' : 's'}</span>
		</div>

		{#each runs as run (run.id)}
			{@const expanded = isOpen(run.id)}
			<div class="run">
				<button
					type="button"
					class="run-head"
					aria-expanded={expanded}
					onclick={() => toggle(run.id)}
				>
					<span class="chev" class:down={expanded}><ChevronRight size={14} /></span>
					<span class="when">{when(run)}</span>
					<span class="status" class:bad={run.is_error} class:live={isLive(run)}>
						{#if isLive(run)}<span class="pulse"></span>{/if}
						{run.status}
					</span>
					{#if !expanded}
						<span class="peek">{peek(run)}</span>
					{/if}
					<span class="run-meta">{meta(run)}</span>
				</button>

				{#if expanded}
					<div class="prompt">
						<div class="ptitle">Prompt</div>
						<div class="ptext">{run.prompt}</div>
					</div>

					<ol class="steps">
						{#each timelines[run.id] ?? [] as entry, i (i)}
							<li class="step" class:sub={entry.subagent}>
								<span class="ico" class:bad={entry.kind === 'result' && entry.isError}>
									{#if entry.kind === 'result' && entry.isError}
										<CircleX size={14} />
									{:else}
										{@const Icon = ICONS[entry.kind]}
										<Icon size={14} />
									{/if}
								</span>
								<span class="body">
									{#if entry.name}<span class="tool">{entry.name}</span>{/if}
									<span class="text">{entry.text}</span>
								</span>
							</li>
						{/each}

						{#if isLive(run)}
							<li class="step">
								<span class="ico"><span class="pulse"></span></span>
								<span class="body">
									<!-- Deliberately not `last_activity`: while a run is live that is the same step
									     the final timeline row already shows, so echoing it prints the line twice. -->
									<span class="text">
										{run.status === 'queued' ? 'Queued — waiting for the sandbox' : 'Working…'}
									</span>
								</span>
							</li>
						{:else if (timelines[run.id] ?? []).length === 0}
							<li class="step">
								<span class="body"><span class="text">No steps recorded.</span></span>
							</li>
						{/if}
					</ol>

					{#if run.error && !isLive(run)}
						<div class="err">{run.error}</div>
					{/if}
				{/if}
			</div>
		{/each}

		{#if error}
			<div class="err">{error}</div>
		{/if}
	</section>
{/if}

<style>
	.agentwrap {
		overflow: hidden;
		/* Matches the 18px the page puts under every other panel; this one sits above the boot log. */
		margin-bottom: 18px;
	}
	.agent-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.agent-bar span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.count {
		font-size: 11px;
		opacity: 0.8;
	}
	.run {
		background: var(--bg-card);
		border-top: 1px solid var(--rule-soft);
	}
	.run:first-of-type {
		border-top: none;
	}
	.run-head {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 9px 14px;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}
	.run-head:hover {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
	}
	.chev {
		flex: none;
		display: inline-flex;
		color: var(--ink-soft);
		transition: transform 120ms ease;
	}
	.chev.down {
		transform: rotate(90deg);
	}
	.when,
	.status,
	.run-meta,
	.peek {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.when {
		flex: none;
		color: var(--ink-soft);
	}
	.status {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--ink-faint);
		padding: 0 5px;
	}
	.status.live {
		border-color: var(--fill);
	}
	.status.bad {
		color: var(--attn-waiting);
		border-color: var(--attn-waiting);
	}
	/* Collapsed rows carry the gist, so the strip is scannable without opening anything. */
	.peek {
		flex: 1;
		min-width: 0;
		color: var(--ink-soft);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.run-meta {
		margin-left: auto;
		flex: none;
		color: var(--ink-faint);
	}
	.prompt {
		padding: 10px 14px;
		border-top: 1px solid var(--rule-soft);
	}
	.ptitle {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
		margin-bottom: 4px;
	}
	.ptext {
		font-size: 12px;
		line-height: 1.5;
		/* The prompt is arbitrary user text, often multi-line — keep its shape but cap the height. */
		white-space: pre-wrap;
		max-height: 7.5em;
		overflow-y: auto;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 420px;
		overflow-y: auto;
	}
	.step {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 8px 14px;
		border-top: 1px solid var(--rule-soft);
	}
	/* A subagent's steps are the nested ones; indent rather than hide them. */
	.step.sub {
		padding-left: 34px;
		opacity: 0.75;
	}
	.ico {
		flex: none;
		display: inline-flex;
		width: 16px;
		height: 16px;
		align-items: center;
		justify-content: center;
		color: var(--ink-soft);
		margin-top: 1px;
	}
	.ico.bad {
		color: var(--attn-waiting);
	}
	.body {
		display: flex;
		gap: 6px;
		min-width: 0;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.tool {
		font-family: var(--font-mono);
		font-size: 11px;
		border: 1px solid var(--ink-faint);
		padding: 0 4px;
		flex: none;
	}
	.text {
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		word-break: break-word;
		min-width: 0;
	}
	.pulse {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--fill);
		animation: agent-pulse 1.6s ease-in-out infinite;
	}
	@keyframes agent-pulse {
		50% {
			opacity: 0.25;
		}
	}
	.err {
		padding: 8px 14px;
		font-family: var(--font-mono);
		font-size: 11px;
		border-top: 1px solid var(--rule-soft);
		color: var(--attn-waiting);
		white-space: pre-wrap;
	}
</style>
