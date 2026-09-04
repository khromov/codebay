<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import Terminal from '@lucide/svelte/icons/terminal';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
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
	let timeline = $state<RunTimelineEntry[]>([]);
	let selected = $state<string | null>(null);
	let loaded = $state(false);
	let error = $state<string | null>(null);

	const current = $derived(runs.find((r) => r.id === selected) ?? runs[0] ?? null);
	const live = $derived(current?.status === 'running' || current?.status === 'queued');

	async function load(runId: string | null) {
		try {
			const q = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
			const data = await apiFetch<{
				runs: AgentRun[];
				run_id: string | null;
				timeline: RunTimelineEntry[];
			}>(`/api/instances/${id}/agent-log${q}`, undefined, 'Could not load the agent log');
			runs = data.runs;
			timeline = data.timeline;
			selected ??= data.run_id;
			error = null;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			loaded = true;
		}
	}

	// Refetches whenever the parent sees a `run` frame for this instance, so a live run's steps
	// appear as they happen without a socket of its own.
	$effect(() => {
		void bump;
		void load(selected);
	});

	function pick(runId: string) {
		selected = runId;
		void load(runId);
	}

	const ICONS = { tool: Terminal, text: MessageSquare, retry: RefreshCw, result: CircleCheck };

	function label(run: AgentRun): string {
		const when = new Date(run.created_at).toLocaleString();
		return `${when} · ${run.status}`;
	}

	function meta(run: AgentRun): string {
		const bits: string[] = [];
		if (run.num_turns != null) bits.push(`${run.num_turns} turns`);
		if (run.cost_usd != null) bits.push(`$${run.cost_usd.toFixed(4)}`);
		if (run.duration_ms != null) bits.push(`${(run.duration_ms / 1000).toFixed(1)}s`);
		return bits.join(' · ');
	}
</script>

{#if loaded && runs.length > 0}
	<section class="agentwrap panel">
		<div class="agent-bar panel-bar">
			<span><Bot size={14} /> Agent log</span>
			{#if runs.length > 1}
				<select
					aria-label="Which agent run to show"
					value={current?.id}
					onchange={(e) => pick(e.currentTarget.value)}
				>
					{#each runs as run (run.id)}
						<option value={run.id}>{label(run)}</option>
					{/each}
				</select>
			{/if}
		</div>

		{#if current}
			<div class="prompt">
				<div class="ptitle">Prompt</div>
				<div class="ptext">{current.prompt}</div>
			</div>

			<ol class="steps">
				{#each timeline as entry, i (i)}
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

				{#if live}
					<li class="step pending">
						<span class="ico"><span class="pulse"></span></span>
						<span class="body">
							<span class="text"
								>{current.status === 'queued'
									? 'Queued — waiting for the sandbox'
									: (current.last_activity ?? 'Working…')}</span
							>
						</span>
					</li>
				{:else if timeline.length === 0}
					<li class="step">
						<span class="body"><span class="text">No steps recorded.</span></span>
					</li>
				{/if}
			</ol>

			{#if current.error && !live}
				<div class="err">{current.error}</div>
			{/if}
			{#if meta(current)}
				<div class="foot">{meta(current)}</div>
			{/if}
		{/if}

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
	.agent-bar select {
		font-family: var(--font-mono);
		font-size: 11px;
		background: var(--bg-card);
		color: var(--ink);
		border: 1px solid var(--edge);
		padding: 2px 4px;
		max-width: 60%;
	}
	.prompt {
		padding: 10px 14px;
		border-bottom: 1px solid var(--rule-soft);
		background: var(--bg-card);
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
		background: var(--bg-card);
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
	.step:first-child {
		border-top: none;
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
	.foot,
	.err {
		padding: 8px 14px;
		font-family: var(--font-mono);
		font-size: 11px;
		border-top: 1px solid var(--rule-soft);
		color: var(--ink-soft);
	}
	.err {
		color: var(--attn-waiting);
		white-space: pre-wrap;
	}
</style>
