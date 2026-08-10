<script lang="ts">
	import Container from '@lucide/svelte/icons/container';
	import AppBar from './AppBar.svelte';
	import Power from '@lucide/svelte/icons/power';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import SunMoon from '@lucide/svelte/icons/sun-moon';
	import ThemePicker from './ThemePicker.svelte';
	import Layers from '@lucide/svelte/icons/layers';
	import FolderMinus from '@lucide/svelte/icons/folder-minus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Hammer from '@lucide/svelte/icons/hammer';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Variable from '@lucide/svelte/icons/variable';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import { Toaster } from 'svelte-french-toast';
	import { flushSync } from 'svelte';
	import { enhance } from 'mochi-framework';
	import type { MochiEnhanceOptions } from 'mochi-framework';
	import { soundEnabled, setSoundEnabled } from '../settings.ts';
	import { playChime, unlockAudio } from '../sound.ts';
	import Button from './Button.svelte';
	import CoinButton from './CoinButton.svelte';
	import Avatar from './Avatar.svelte';
	import { avatars, findAvatar, type AvatarArt } from '../avatars/index.ts';
	import type { InstanceMode } from '../types.ts';
	import Terminal from '@lucide/svelte/icons/terminal';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import { installPopupBackTrap } from '../lib/popup-nav.ts';

	/** Every settings form action fails with the same `{ error }` shape. */
	type ActionFailure = { error: string };

	let {
		pet,
		defaultMode,
		defaultImage,
		builtinImage,
		disableBuildCache,
		copyIgnorePatterns,
		builtinCopyIgnore,
		gitIdentityEnabled,
		gitIdentityName,
		gitIdentityEmail,
		dockerArch,
		manualTokensEnabled,
		githubTokenSet,
		claudeTokenSet,
		customEndpointEnabled,
		customEndpointBaseUrl,
		customEndpointTokenSet,
		customEndpointOpusModel,
		customEndpointSonnetModel,
		customEndpointHaikuModel,
		customEndpointSmallFastModel,
		customEndpointModel,
		manualModelOverrideEnabled,
		manualOpusModel,
		manualSonnetModel,
		manualHaikuModel,
		manualSmallFastModel,
		manualModel,
		hostEnvVarsEnabled,
		hostEnvVarNames,
		hostEnvVarPresence,
		advancedSerialInjections,
		advancedNoBuildkit,
		advancedBlockingExtInstall,
		version
	}: {
		pet?: AvatarArt;
		defaultMode: InstanceMode;
		defaultImage: string;
		builtinImage: string;
		disableBuildCache: boolean;
		copyIgnorePatterns: string;
		builtinCopyIgnore: string;
		gitIdentityEnabled: boolean;
		gitIdentityName: string;
		gitIdentityEmail: string;
		dockerArch: string | null;
		manualTokensEnabled: boolean;
		githubTokenSet: boolean;
		claudeTokenSet: boolean;
		customEndpointEnabled: boolean;
		customEndpointBaseUrl: string;
		customEndpointTokenSet: boolean;
		customEndpointOpusModel: string;
		customEndpointSonnetModel: string;
		customEndpointHaikuModel: string;
		customEndpointSmallFastModel: string;
		customEndpointModel: string;
		manualModelOverrideEnabled: boolean;
		manualOpusModel: string;
		manualSonnetModel: string;
		manualHaikuModel: string;
		manualSmallFastModel: string;
		manualModel: string;
		hostEnvVarsEnabled: boolean;
		hostEnvVarNames: string[];
		hostEnvVarPresence: Record<string, boolean>;
		advancedSerialInjections: boolean;
		advancedNoBuildkit: boolean;
		advancedBlockingExtInstall: boolean;
		version: string;
	} = $props();

	// Defaults to on during SSR, where localStorage doesn't exist.
	let sound = $state(soundEnabled());

	// DB-backed, so it initializes from the prop. Undefined is the off state — the header keeps its box logo.
	// svelte-ignore state_referenced_locally
	let petArt = $state(pet);
	let savingPet = $state(false);
	let petError = $state<string | null>(null);

	let shuttingDown = $state(false);

	$effect(() => installPopupBackTrap());

	/** Reused by every plain save form below; only the per-control state setters differ. */
	function saveOpts<Success extends Record<string, unknown> = Record<string, unknown>>(handlers: {
		setSaving: (v: boolean) => void;
		setError: (v: string | null) => void;
		setMsg?: (v: string | null) => void;
		onSuccess: (data: Success | undefined) => void;
		confirmMessage?: string;
	}): MochiEnhanceOptions<Success, ActionFailure> {
		return {
			onPending: handlers.setSaving,
			submit: ({ cancel }) => {
				if (handlers.confirmMessage && !confirm(handlers.confirmMessage)) {
					cancel();
					return;
				}
				handlers.setError(null);
				handlers.setMsg?.(null);
				return ({ result }) => {
					if (result.type === 'success') {
						handlers.onSuccess(result.data);
					} else if (result.type === 'failure') {
						handlers.setError(result.data?.error ?? 'Request failed');
					} else if (result.type === 'error') {
						handlers.setError('Network error. Try again.');
					}
				};
			}
		};
	}

	/**
	 * The optimistic flip is free: `onchange` fires before submit, so `formData`
	 * already carries the new value. Failure reverts to the opposite of what was sent.
	 */
	function toggleOpts<Success extends Record<string, unknown> = Record<string, unknown>>(handlers: {
		set: (v: boolean) => void;
		setSaving: (v: boolean) => void;
		setError: (v: string | null) => void;
		onSuccess?: (data: Success | undefined) => void;
	}): MochiEnhanceOptions<Success, ActionFailure> {
		return {
			onPending: handlers.setSaving,
			submit: ({ formData }) => {
				const intended = formData.get('enabled') === 'on';
				handlers.setError(null);
				return ({ result }) => {
					if (result.type === 'success') {
						handlers.onSuccess?.(result.data);
						return;
					}
					handlers.set(!intended);
					handlers.setError(
						result.type === 'failure'
							? (result.data?.error ?? 'Request failed')
							: 'Network error. Try again.'
					);
				};
			}
		};
	}

	// DB-backed, so it initializes from the prop; a per-instance choice in the picker overrides it.
	// svelte-ignore state_referenced_locally
	let modeChoice = $state<InstanceMode>(defaultMode);
	let savingMode = $state(false);
	let modeError = $state<string | null>(null);
	let modeFormEl: HTMLFormElement | undefined;

	const defaultModeOpts = saveOpts<{ mode: InstanceMode }>({
		setSaving: (v) => (savingMode = v),
		setError: (v) => (modeError = v),
		setMsg: () => {},
		onSuccess: (data) => {
			if (data?.mode) modeChoice = data.mode;
		}
	});

	// Set the bound hidden value then resubmit, mirroring the image reset (flushSync before requestSubmit).
	function chooseMode(next: InstanceMode) {
		if (next === modeChoice) return;
		flushSync(() => (modeChoice = next));
		modeFormEl?.requestSubmit();
	}

	// svelte-ignore state_referenced_locally
	let image = $state(defaultImage);
	let savingImage = $state(false);
	let imageError = $state<string | null>(null);
	let imageSaved = $state(false);
	let imageFormEl: HTMLFormElement | undefined;

	const imageOpts = saveOpts<{ image: string }>({
		setSaving: (v) => (savingImage = v),
		setError: (v) => (imageError = v),
		setMsg: (v) => (imageSaved = !!v),
		onSuccess: (data) => {
			image = data?.image ?? image;
			imageSaved = true;
		}
	});

	// Setting the bound value then resubmitting keeps this a one-form control.
	function resetImage() {
		// flushSync forces the bind:value DOM update to happen before requestSubmit
		// reads the input's value via FormData — otherwise it would submit the stale value.
		flushSync(() => (image = builtinImage));
		imageFormEl?.requestSubmit();
	}

	// Unlike the image field, an empty value is valid here — it means "copy everything".
	// svelte-ignore state_referenced_locally
	let copyIgnore = $state(copyIgnorePatterns);
	let savingCopyIgnore = $state(false);
	let copyIgnoreError = $state<string | null>(null);
	let copyIgnoreSaved = $state(false);
	let copyIgnoreFormEl: HTMLFormElement | undefined;

	const copyIgnoreOpts = saveOpts<{ patterns: string }>({
		setSaving: (v) => (savingCopyIgnore = v),
		setError: (v) => (copyIgnoreError = v),
		setMsg: (v) => (copyIgnoreSaved = !!v),
		onSuccess: (data) => {
			copyIgnore = data?.patterns ?? copyIgnore;
			copyIgnoreSaved = true;
		}
	});

	function resetCopyIgnore() {
		flushSync(() => (copyIgnore = builtinCopyIgnore));
		copyIgnoreFormEl?.requestSubmit();
	}

	// svelte-ignore state_referenced_locally
	let gitIdentity = $state(gitIdentityEnabled);
	let savingGitToggle = $state(false);
	let gitToggleError = $state<string | null>(null);

	const gitIdentityToggleOpts = toggleOpts({
		set: (v) => (gitIdentity = v),
		setSaving: (v) => (savingGitToggle = v),
		setError: (v) => (gitToggleError = v)
	});

	// Both fields must be saved together — a lone name or email doesn't count as an override.
	// svelte-ignore state_referenced_locally
	let gitName = $state(gitIdentityName);
	// svelte-ignore state_referenced_locally
	let gitEmail = $state(gitIdentityEmail);
	let savingGitIdentity = $state(false);
	let gitIdentityError = $state<string | null>(null);
	let gitIdentitySaved = $state(false);

	const gitIdentityOpts = saveOpts<{ name: string; email: string }>({
		setSaving: (v) => (savingGitIdentity = v),
		setError: (v) => (gitIdentityError = v),
		setMsg: (v) => (gitIdentitySaved = !!v),
		onSuccess: (data) => {
			gitName = data?.name ?? gitName;
			gitEmail = data?.email ?? gitEmail;
			gitIdentitySaved = true;
		}
	});

	// DB-backed rather than localStorage, so it initializes from the prop.
	// svelte-ignore state_referenced_locally
	let noCache = $state(disableBuildCache);
	let savingCache = $state(false);
	let cacheError = $state<string | null>(null);

	const buildCacheToggleOpts = toggleOpts({
		set: (v) => (noCache = v),
		setSaving: (v) => (savingCache = v),
		setError: (v) => (cacheError = v)
	});

	let clearing = $state(false);
	let clearMsg = $state<string | null>(null);
	let clearError = $state<string | null>(null);

	function formatBytes(n: number): string {
		if (n <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
		return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	const clearCacheOpts = saveOpts<{ spaceReclaimed: number }>({
		setSaving: (v) => (clearing = v),
		setError: (v) => (clearError = v),
		setMsg: (v) => (clearMsg = v),
		onSuccess: (data) => {
			clearMsg = `Cleared — freed ${formatBytes(data?.spaceReclaimed ?? 0)}.`;
		}
	});

	let rebuilding = $state(false);
	let rebuildMsg = $state<string | null>(null);
	let rebuildError = $state<string | null>(null);

	const rebuildAllOpts = saveOpts<{ count: number }>({
		setSaving: (v) => (rebuilding = v),
		setError: (v) => (rebuildError = v),
		setMsg: (v) => (rebuildMsg = v),
		confirmMessage:
			'Rebuild every running container from scratch (no build cache)? Each will restart and may take a while.',
		onSuccess: (data) => {
			const n = data?.count ?? 0;
			rebuildMsg = n === 0 ? 'No running containers to rebuild.' : `Rebuilding ${n} container(s)…`;
		}
	});

	// DB-backed advanced escape hatches, so they initialize from the props.
	// svelte-ignore state_referenced_locally
	let serialInjections = $state(advancedSerialInjections);
	let savingSerial = $state(false);
	let serialError = $state<string | null>(null);
	const serialOpts = toggleOpts({
		set: (v) => (serialInjections = v),
		setSaving: (v) => (savingSerial = v),
		setError: (v) => (serialError = v)
	});

	// svelte-ignore state_referenced_locally
	let noBuildkit = $state(advancedNoBuildkit);
	let savingBuildkit = $state(false);
	let buildkitError = $state<string | null>(null);
	const buildkitOpts = toggleOpts({
		set: (v) => (noBuildkit = v),
		setSaving: (v) => (savingBuildkit = v),
		setError: (v) => (buildkitError = v)
	});

	// svelte-ignore state_referenced_locally
	let blockingExtInstall = $state(advancedBlockingExtInstall);
	let savingBlocking = $state(false);
	let blockingError = $state<string | null>(null);
	const blockingOpts = toggleOpts({
		set: (v) => (blockingExtInstall = v),
		setSaving: (v) => (savingBlocking = v),
		setError: (v) => (blockingError = v)
	});

	let clearingVer = $state(false);
	let verMsg = $state<string | null>(null);
	let verError = $state<string | null>(null);
	const clearVersionOpts = saveOpts({
		setSaving: (v) => (clearingVer = v),
		setError: (v) => (verError = v),
		setMsg: (v) => (verMsg = v),
		onSuccess: () => {
			verMsg = 'Cleared — the next instance boot re-checks the registry.';
		}
	});

	// Token values never reach the client; only whether each is set, for the placeholder.
	// svelte-ignore state_referenced_locally
	let manualTokens = $state(manualTokensEnabled);
	let savingManualToggle = $state(false);
	let manualToggleError = $state<string | null>(null);

	const manualTokensToggleOpts = toggleOpts({
		set: (v) => (manualTokens = v),
		setSaving: (v) => (savingManualToggle = v),
		setError: (v) => (manualToggleError = v)
	});

	// svelte-ignore state_referenced_locally
	let ghSaved = $state(githubTokenSet);
	let githubToken = $state('');
	let savingGithub = $state(false);
	let githubMsg = $state<string | null>(null);
	let githubError = $state<string | null>(null);

	const githubTokenOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingGithub = v),
		setError: (v) => (githubError = v),
		setMsg: (v) => (githubMsg = v),
		onSuccess: (data) => {
			ghSaved = data?.set ?? false;
			githubToken = '';
			githubMsg = ghSaved ? 'Saved.' : 'Cleared.';
		}
	});

	// svelte-ignore state_referenced_locally
	let claudeSaved = $state(claudeTokenSet);
	let claudeToken = $state('');
	let savingClaude = $state(false);
	let claudeMsg = $state<string | null>(null);
	let claudeError = $state<string | null>(null);

	const claudeTokenOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingClaude = v),
		setError: (v) => (claudeError = v),
		setMsg: (v) => (claudeMsg = v),
		onSuccess: (data) => {
			claudeSaved = data?.set ?? false;
			claudeToken = '';
			claudeMsg = claudeSaved ? 'Saved.' : 'Cleared.';
		}
	});

	// As with manual tokens, the token value never comes back from the server.
	// svelte-ignore state_referenced_locally
	let customEndpoint = $state(customEndpointEnabled);
	let savingCustomToggle = $state(false);
	let customToggleError = $state<string | null>(null);

	const customEndpointToggleOpts = toggleOpts({
		set: (v) => (customEndpoint = v),
		setSaving: (v) => (savingCustomToggle = v),
		setError: (v) => (customToggleError = v),
		// Enabling LiteLLM disables the manual override server-side; keep the UI in sync.
		onSuccess: (data) => {
			if ((data as { enabled?: boolean } | undefined)?.enabled) manualModelOverride = false;
		}
	});

	// svelte-ignore state_referenced_locally
	let customBaseUrl = $state(customEndpointBaseUrl);
	let savingCustomBaseUrl = $state(false);
	let customBaseUrlMsg = $state<string | null>(null);
	let customBaseUrlError = $state<string | null>(null);

	const customBaseUrlOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingCustomBaseUrl = v),
		setError: (v) => (customBaseUrlError = v),
		setMsg: (v) => (customBaseUrlMsg = v),
		onSuccess: (data) => {
			customBaseUrlMsg = data?.set ? 'Saved.' : 'Cleared.';
		}
	});

	let customToken = $state('');
	// svelte-ignore state_referenced_locally
	let customTokenSaved = $state(customEndpointTokenSet);
	let savingCustomToken = $state(false);
	let customTokenMsg = $state<string | null>(null);
	let customTokenError = $state<string | null>(null);

	const customTokenOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingCustomToken = v),
		setError: (v) => (customTokenError = v),
		setMsg: (v) => (customTokenMsg = v),
		onSuccess: (data) => {
			customTokenSaved = data?.set ?? false;
			customToken = '';
			customTokenMsg = customTokenSaved ? 'Saved.' : 'Cleared.';
		}
	});

	// svelte-ignore state_referenced_locally
	let customOpusModel = $state(customEndpointOpusModel);
	// svelte-ignore state_referenced_locally
	let customSonnetModel = $state(customEndpointSonnetModel);
	// svelte-ignore state_referenced_locally
	let customHaikuModel = $state(customEndpointHaikuModel);
	// svelte-ignore state_referenced_locally
	let customSmallFastModel = $state(customEndpointSmallFastModel);
	// svelte-ignore state_referenced_locally
	let customDefaultModel = $state(customEndpointModel);
	let savingCustomModels = $state(false);
	let customModelsMsg = $state<string | null>(null);
	let customModelsError = $state<string | null>(null);

	const customModelsOpts = saveOpts({
		setSaving: (v) => (savingCustomModels = v),
		setError: (v) => (customModelsError = v),
		setMsg: (v) => (customModelsMsg = v),
		onSuccess: () => {
			customModelsMsg = 'Saved.';
		}
	});

	// svelte-ignore state_referenced_locally
	let manualModelOverride = $state(manualModelOverrideEnabled);
	let savingManualModelToggle = $state(false);
	let manualModelToggleError = $state<string | null>(null);

	const manualModelToggleOpts = toggleOpts({
		set: (v) => (manualModelOverride = v),
		setSaving: (v) => (savingManualModelToggle = v),
		setError: (v) => (manualModelToggleError = v),
		// Enabling this disables LiteLLM server-side; mirror that here so the UI stays consistent.
		onSuccess: (data) => {
			if ((data as { enabled?: boolean } | undefined)?.enabled) customEndpoint = false;
		}
	});

	// svelte-ignore state_referenced_locally
	let manualOpus = $state(manualOpusModel);
	// svelte-ignore state_referenced_locally
	let manualSonnet = $state(manualSonnetModel);
	// svelte-ignore state_referenced_locally
	let manualHaiku = $state(manualHaikuModel);
	// svelte-ignore state_referenced_locally
	let manualSmallFast = $state(manualSmallFastModel);
	// svelte-ignore state_referenced_locally
	let manualDefault = $state(manualModel);
	let savingManualModels = $state(false);
	let manualModelsMsg = $state<string | null>(null);
	let manualModelsError = $state<string | null>(null);

	const manualModelsOpts = saveOpts({
		setSaving: (v) => (savingManualModels = v),
		setError: (v) => (manualModelsError = v),
		setMsg: (v) => (manualModelsMsg = v),
		onSuccess: () => {
			manualModelsMsg = 'Saved.';
		}
	});

	// LiteLLM is incompatible with both manual tokens and the manual model override.
	let litellmBlocker = $derived(
		manualTokens ? 'Set tokens manually' : manualModelOverride ? 'Override models manually' : null
	);

	// Only names round-trip; `hostEnvPresence` is refreshed from each save response so a
	// newly-added name doesn't read as "missing" until the next full page load.
	// svelte-ignore state_referenced_locally
	let hostEnvVars = $state(hostEnvVarsEnabled);
	let savingHostEnvToggle = $state(false);
	let hostEnvToggleError = $state<string | null>(null);

	const hostEnvVarsToggleOpts = toggleOpts<{ presence: Record<string, boolean> }>({
		set: (v) => (hostEnvVars = v),
		setSaving: (v) => (savingHostEnvToggle = v),
		setError: (v) => (hostEnvToggleError = v),
		onSuccess: (data) => {
			hostEnvPresence = data?.presence ?? {};
		}
	});

	// svelte-ignore state_referenced_locally
	let hostEnvNames = $state([...hostEnvVarNames]);
	// svelte-ignore state_referenced_locally
	let hostEnvPresence = $state({ ...hostEnvVarPresence });
	let newHostEnvName = $state('');
	let savingHostEnvNames = $state(false);
	let hostEnvNamesMsg = $state<string | null>(null);
	let hostEnvNamesError = $state<string | null>(null);

	/**
	 * Add form: submits every existing name (as hidden inputs) plus the free-text
	 * input, all under the repeated `names` field — the last entry is always the
	 * typed value. Validated and normalized (uppercased, deduped) here, in the
	 * submit callback, by mutating `formData` directly before the fetch fires —
	 * mirrors the old client-side pre-check without a second code path.
	 */
	const addHostEnvOpts: MochiEnhanceOptions<{ presence: Record<string, boolean> }, ActionFailure> =
		{
			onPending: (v) => (savingHostEnvNames = v),
			submit: ({ formData, cancel }) => {
				hostEnvNamesError = null;
				hostEnvNamesMsg = null;
				const existing = formData.getAll('names').map(String);
				const typed = existing.pop() ?? '';
				const name = typed.trim().toUpperCase();
				if (!name) {
					cancel();
					return;
				}
				if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
					hostEnvNamesError = `Invalid variable name: ${name}`;
					cancel();
					return;
				}
				newHostEnvName = '';
				if (existing.includes(name)) {
					cancel();
					return;
				}
				const names = [...existing, name];
				formData.delete('names');
				for (const n of names) formData.append('names', n);
				return ({ result }) => {
					if (result.type === 'success') {
						hostEnvNames = names;
						hostEnvPresence = result.data?.presence ?? {};
						hostEnvNamesMsg = 'Saved.';
					} else if (result.type === 'failure') {
						hostEnvNamesError = result.data?.error ?? 'Request failed';
					} else if (result.type === 'error') {
						hostEnvNamesError = 'Network error. Try again.';
					}
				};
			}
		};

	/** Remove form (one per row): submits every name except this one. */
	function removeHostEnvOpts(name: string) {
		return saveOpts<{ presence: Record<string, boolean> }>({
			setSaving: (v) => (savingHostEnvNames = v),
			setError: (v) => (hostEnvNamesError = v),
			setMsg: (v) => (hostEnvNamesMsg = v),
			onSuccess: (data) => {
				hostEnvNames = hostEnvNames.filter((n) => n !== name);
				hostEnvPresence = data?.presence ?? {};
			}
		});
	}

	function toggleSound(on: boolean) {
		sound = on;
		setSoundEnabled(on);
		// A toggle is a user gesture — unlock audio and preview when enabling.
		unlockAudio();
		if (on) playChime('done');
	}

	// State is object-shaped (the chosen sprite), so this can't reuse the boolean `toggleOpts`.
	const petToggleOpts: MochiEnhanceOptions<{ enabled: boolean; name?: string }, ActionFailure> = {
		onPending: (v) => (savingPet = v),
		submit: () => {
			petError = null;
			return ({ result }) => {
				if (result.type === 'success') {
					petArt = result.data?.name ? findAvatar(result.data.name) : undefined;
					return;
				}
				petError =
					result.type === 'failure'
						? (result.data?.error ?? 'Request failed')
						: 'Network error. Try again.';
			};
		}
	};

	function petChooseOpts(art: AvatarArt) {
		return saveOpts<{ name: string }>({
			setSaving: (v) => (savingPet = v),
			setError: (v) => (petError = v),
			onSuccess: (data) => {
				petArt = (data?.name ? findAvatar(data.name) : undefined) ?? art;
			}
		});
	}

	// The server exits mid-flight, so a dropped connection means success here too.
	const shutdownOpts: MochiEnhanceOptions<Record<string, never>, ActionFailure> = {
		submit: ({ cancel }) => {
			if (
				!confirm(
					'Delete the database, remove all instances and their containers, and shut down the server? This cannot be undone.'
				)
			) {
				cancel();
				return;
			}
			shuttingDown = true;
		}
	};
</script>

<div class="page">
	<AppBar>
		<span class="title">Settings</span>
	</AppBar>

	<main class="content">
		<section class="card">
			<form
				class="row"
				method="POST"
				action="?/defaultMode"
				bind:this={modeFormEl}
				{@attach enhance(defaultModeOpts)}
			>
				<div class="label">
					<Terminal size={20} />
					<div class="text">
						<div class="name">Default editor</div>
						<div class="desc">
							What new instances start in. <strong>Full IDE</strong> serves browser VS Code;
							<strong>Terminal</strong> is lighter — just Claude Code in a terminal, no code-server. You
							can override this per instance when creating one.
						</div>
					</div>
				</div>
				<input type="hidden" name="mode" value={modeChoice} />
				<div class="mode-toggle" role="group" aria-label="Default editor mode">
					<button
						type="button"
						class="mode-btn"
						class:active={modeChoice === 'ide'}
						aria-pressed={modeChoice === 'ide'}
						disabled={savingMode}
						onclick={() => chooseMode('ide')}
					>
						<LayoutTemplate size={15} />
						Full IDE
					</button>
					<button
						type="button"
						class="mode-btn"
						class:active={modeChoice === 'terminal'}
						aria-pressed={modeChoice === 'terminal'}
						disabled={savingMode}
						onclick={() => chooseMode('terminal')}
					>
						<Terminal size={15} />
						Terminal
					</button>
				</div>
			</form>
			{#if modeError}
				<div class="sub"><div class="msg error">{modeError}</div></div>
			{/if}
		</section>

		<section class="card">
			<form
				class="row image-row"
				method="POST"
				action="?/defaultImage"
				bind:this={imageFormEl}
				{@attach enhance(imageOpts)}
			>
				<div class="label">
					<Container size={20} />
					<div class="text">
						<div class="name">
							Default container image
							{#if dockerArch}
								<span class="arch" title="Docker daemon architecture">{dockerArch}</span>
							{/if}
						</div>
						<div class="desc">
							Used only when a project folder ships no devcontainer.json. Takes effect for instances
							created from now on.
						</div>
					</div>
				</div>
				<div class="image-controls">
					<input
						type="text"
						name="image"
						class="image-input"
						bind:value={image}
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
						placeholder="mcr.microsoft.com/devcontainers/base:ubuntu"
					/>
					<Button type="submit" disabled={savingImage}>Save</Button>
					<Button
						type="button"
						icon={RotateCcw}
						disabled={savingImage}
						onclick={resetImage}
						title="Reset to default ({builtinImage})"
						aria-label="Reset to default image"
					/>
				</div>
				<div class="desc tip">
					{#if dockerArch}
						Your Docker daemon runs on <strong>{dockerArch}</strong> — pick an image that publishes
						an <strong>{dockerArch}</strong> manifest, or the pull will fail.
					{:else}
						Pick an image whose manifest covers your Docker daemon's architecture, or the pull will
						fail.
					{/if}
				</div>
				{#if imageError}
					<div class="msg error">{imageError}</div>
				{:else if imageSaved}
					<div class="msg ok">Saved.</div>
				{/if}
			</form>
		</section>

		<section class="card">
			<form
				class="row image-row"
				method="POST"
				action="?/copyIgnorePatterns"
				bind:this={copyIgnoreFormEl}
				{@attach enhance(copyIgnoreOpts)}
			>
				<div class="label">
					<FolderMinus size={20} />
					<div class="text">
						<div class="name">Skip when copying a local folder</div>
						<div class="desc">
							Comma-separated folder/file names excluded when copying a local source folder into a
							new instance's workspace. Leave blank to copy everything. Only applies to local
							folders — cloning a Git repo URL is unaffected.
						</div>
					</div>
				</div>
				<div class="image-controls">
					<input
						type="text"
						name="patterns"
						class="image-input"
						bind:value={copyIgnore}
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
						placeholder="node_modules, .venv, dist"
					/>
					<Button type="submit" disabled={savingCopyIgnore}>Save</Button>
					<Button
						type="button"
						icon={RotateCcw}
						disabled={savingCopyIgnore}
						onclick={resetCopyIgnore}
						title="Reset to default ({builtinCopyIgnore})"
						aria-label="Reset to default copy-ignore patterns"
					/>
				</div>
				{#if copyIgnoreError}
					<div class="msg error">{copyIgnoreError}</div>
				{:else if copyIgnoreSaved}
					<div class="msg ok">Saved.</div>
				{/if}
			</form>
		</section>

		<section class="card">
			<form
				class="row"
				method="POST"
				action="?/gitIdentityToggle"
				{@attach enhance(gitIdentityToggleOpts)}
			>
				<div class="label">
					<UserCog size={20} />
					<div class="text">
						<div class="name">Override git identity</div>
						<div class="desc">
							Inject a name and email as <code>git config --global user.name/user.email</code> in every
							new container, taking precedence over the host's own git config. When off, each container
							falls back to the host's identity.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={gitIdentity}
						disabled={savingGitToggle}
						onchange={(e) => {
							gitIdentity = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if gitToggleError}
				<div class="sub"><div class="msg error">{gitToggleError}</div></div>
			{/if}

			{#if gitIdentity}
				<form
					class="row divided token-row"
					method="POST"
					action="?/gitIdentityOverride"
					{@attach enhance(gitIdentityOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Identity</div>
							<div class="desc">
								Both fields are required — leave either blank and the container falls back to the
								host's identity.
							</div>
						</div>
					</div>
					<div class="model-fields">
						<label class="model-row">
							<span class="model-label">Name</span>
							<input
								type="text"
								name="name"
								class="image-input"
								bind:value={gitName}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								placeholder="Jane Doe"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Email</span>
							<input
								type="text"
								name="email"
								class="image-input"
								bind:value={gitEmail}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								placeholder="jane@example.com"
							/>
						</label>
						<div class="model-save-row">
							<Button type="submit" disabled={savingGitIdentity}>Save</Button>
						</div>
					</div>
					{#if gitIdentityError}
						<div class="msg error">{gitIdentityError}</div>
					{:else if gitIdentitySaved}
						<div class="msg ok">Saved.</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card">
			<form
				class="row"
				method="POST"
				action="?/disableBuildCache"
				{@attach enhance(buildCacheToggleOpts)}
			>
				<div class="label">
					<Layers size={20} />
					<div class="text">
						<div class="name">Disable build cache</div>
						<div class="desc">
							Build every new container with <code>--build-no-cache</code>. Applies to first boot
							and rebuilds — slower, but always picks up upstream image/layer changes.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={noCache}
						disabled={savingCache}
						onchange={(e) => {
							noCache = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if cacheError}
				<div class="sub"><div class="msg error">{cacheError}</div></div>
			{/if}

			<form
				class="row divided"
				method="POST"
				action="?/clearBuildCache"
				{@attach enhance(clearCacheOpts)}
			>
				<div class="label">
					<Trash2 size={20} />
					<div class="text">
						<div class="name">Clear build cache</div>
						<div class="desc">
							Purge Docker's BuildKit layer cache now, so the next build runs uncached. Doesn't
							remove pulled images.
						</div>
						{#if clearError}
							<div class="msg error">{clearError}</div>
						{:else if clearMsg}
							<div class="msg ok">{clearMsg}</div>
						{/if}
					</div>
				</div>
				<Button type="submit" icon={Trash2} disabled={clearing}>
					{clearing ? 'Clearing…' : 'Clear cache'}
				</Button>
			</form>

			<form
				class="row divided"
				method="POST"
				action="?/rebuildAllNoCache"
				{@attach enhance(rebuildAllOpts)}
			>
				<div class="label">
					<Hammer size={20} />
					<div class="text">
						<div class="name">Rebuild running containers (no cache)</div>
						<div class="desc">
							Rebuild every currently-running instance from scratch, without using any cached image
							layers. In-container edits are kept; stopped instances are left alone.
						</div>
						{#if rebuildError}
							<div class="msg error">{rebuildError}</div>
						{:else if rebuildMsg}
							<div class="msg ok">{rebuildMsg}</div>
						{/if}
					</div>
				</div>
				<Button type="submit" icon={Hammer} disabled={rebuilding}>
					{rebuilding ? 'Starting…' : 'Rebuild all'}
				</Button>
			</form>
		</section>

		<section class="card" class:disabled-card={customEndpoint}>
			<form
				class="row"
				method="POST"
				action="?/manualTokensToggle"
				{@attach enhance(manualTokensToggleOpts)}
			>
				<div class="label">
					<KeyRound size={20} />
					<div class="text">
						<div class="name">
							Set tokens manually
							{#if customEndpoint}
								<span class="arch" title="Disabled while LiteLLM + Bedrock mode is on"
									>disabled</span
								>
							{/if}
						</div>
						<div class="desc">
							{#if customEndpoint}
								Not available while LiteLLM + Bedrock mode is enabled — Claude credentials are
								provided by the LiteLLM endpoint instead.
							{:else}
								Provide GitHub and Claude Code tokens yourself instead of discovering them from this
								machine. Useful on a headless server or when signed in as a different identity. A
								token set here is injected into every new container and overrides host credential
								discovery.
							{/if}
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={manualTokens}
						disabled={savingManualToggle || customEndpoint}
						onchange={(e) => {
							manualTokens = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if manualToggleError}
				<div class="sub"><div class="msg error">{manualToggleError}</div></div>
			{/if}

			{#if manualTokens && !customEndpoint}
				<form
					class="row divided token-row"
					method="POST"
					action="?/githubToken"
					{@attach enhance(githubTokenOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">GitHub token</div>
							<div class="desc">
								macOS / Linux: run <code>gh auth token</code> to print your GitHub CLI token, or
								create a Personal Access Token at
								<code>github.com/settings/tokens</code> (scopes: <code>repo</code>,
								<code>read:org</code>). Leave blank and Save to clear.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="password"
							name="githubToken"
							class="image-input"
							bind:value={githubToken}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder={ghSaved ? '•••••••• (saved)' : 'ghp_… / gho_…'}
						/>
						<Button type="submit" disabled={savingGithub}>Save</Button>
					</div>
					{#if githubError}
						<div class="msg error">{githubError}</div>
					{:else if githubMsg}
						<div class="msg ok">{githubMsg}</div>
					{/if}
				</form>

				<form
					class="row divided token-row"
					method="POST"
					action="?/claudeToken"
					{@attach enhance(claudeTokenOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Claude Code token</div>
							<div class="desc">
								macOS / Linux: run <code>claude setup-token</code> to mint a long-lived token and
								paste it here. Copying a live login out of the keychain or
								<code>~/.claude/.credentials.json</code> works too, but that credential rotates —
								the first <code>claude</code> to refresh it signs the other one out. Leave blank and Save
								to clear.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="password"
							name="claudeToken"
							class="image-input"
							bind:value={claudeToken}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder={claudeSaved ? '•••••••• (saved)' : 'sk-ant-oat…'}
						/>
						<Button type="submit" disabled={savingClaude}>Save</Button>
					</div>
					{#if claudeError}
						<div class="msg error">{claudeError}</div>
					{:else if claudeMsg}
						<div class="msg ok">{claudeMsg}</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card" class:disabled-card={litellmBlocker}>
			<form
				class="row"
				method="POST"
				action="?/customEndpointToggle"
				{@attach enhance(customEndpointToggleOpts)}
			>
				<div class="label">
					<KeyRound size={20} />
					<div class="text">
						<div class="name">
							LiteLLM + Bedrock
							{#if litellmBlocker}
								<span class="arch" title="Disabled while {litellmBlocker} is on">disabled</span>
							{/if}
						</div>
						<div class="desc">
							{#if litellmBlocker}
								Not available while "{litellmBlocker}" is enabled — these modes are mutually
								incompatible.
							{:else}
								Route <code>claude</code> through a LiteLLM proxy fronting AWS Bedrock instead of Anthropic's
								default API. When enabled, the Bedrock endpoint variables are injected into every new
								container, host OAuth credentials are not used, and "Set tokens manually" is disabled.
							{/if}
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={customEndpoint}
						disabled={savingCustomToggle || !!litellmBlocker}
						onchange={(e) => {
							customEndpoint = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if customToggleError}
				<div class="sub"><div class="msg error">{customToggleError}</div></div>
			{/if}

			{#if customEndpoint}
				<form
					class="row divided token-row"
					method="POST"
					action="?/customBaseUrl"
					{@attach enhance(customBaseUrlOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Base URL</div>
							<div class="desc">
								The LiteLLM proxy endpoint, e.g.
								<code>https://litellm.example.com/bedrock</code>. Passed as
								<code>ANTHROPIC_BEDROCK_BASE_URL</code>.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="text"
							name="baseUrl"
							class="image-input"
							bind:value={customBaseUrl}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder="https://litellm.example.com/bedrock"
						/>
						<Button type="submit" disabled={savingCustomBaseUrl}>Save</Button>
					</div>
					{#if customBaseUrlError}
						<div class="msg error">{customBaseUrlError}</div>
					{:else if customBaseUrlMsg}
						<div class="msg ok">{customBaseUrlMsg}</div>
					{/if}
				</form>

				<form
					class="row divided token-row"
					method="POST"
					action="?/customToken"
					{@attach enhance(customTokenOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Auth token</div>
							<div class="desc">
								Your LiteLLM API key. Passed as <code>ANTHROPIC_AUTH_TOKEN</code>. Leave blank and
								Save to clear.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="password"
							name="token"
							class="image-input"
							bind:value={customToken}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder={customTokenSaved ? '•••••••• (saved)' : 'sk-…'}
						/>
						<Button type="submit" disabled={savingCustomToken}>Save</Button>
					</div>
					{#if customTokenError}
						<div class="msg error">{customTokenError}</div>
					{:else if customTokenMsg}
						<div class="msg ok">{customTokenMsg}</div>
					{/if}
				</form>

				<form
					class="row divided token-row"
					method="POST"
					action="?/customModels"
					{@attach enhance(customModelsOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Model IDs</div>
							<div class="desc">
								Model aliases to use for each tier. Prefilled with defaults from the reference
								launcher script. Leave a field as-is to keep its current value.
							</div>
						</div>
					</div>
					<div class="model-fields">
						<label class="model-row">
							<span class="model-label">Opus</span>
							<input
								type="text"
								name="opusModel"
								class="image-input"
								bind:value={customOpusModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Sonnet</span>
							<input
								type="text"
								name="sonnetModel"
								class="image-input"
								bind:value={customSonnetModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Haiku</span>
							<input
								type="text"
								name="haikuModel"
								class="image-input"
								bind:value={customHaikuModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Small/fast</span>
							<input
								type="text"
								name="smallFastModel"
								class="image-input"
								bind:value={customSmallFastModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Default</span>
							<input
								type="text"
								name="defaultModel"
								class="image-input"
								bind:value={customDefaultModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<div class="model-save-row">
							<Button type="submit" disabled={savingCustomModels}>Save models</Button>
						</div>
					</div>
					{#if customModelsError}
						<div class="msg error">{customModelsError}</div>
					{:else if customModelsMsg}
						<div class="msg ok">{customModelsMsg}</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card" class:disabled-card={customEndpoint}>
			<form
				class="row"
				method="POST"
				action="?/manualModelToggle"
				{@attach enhance(manualModelToggleOpts)}
			>
				<div class="label">
					<Cpu size={18} />
					<div class="text">
						<div class="name">
							Override models manually
							{#if customEndpoint}
								<span class="arch" title="Disabled while LiteLLM + Bedrock is on">disabled</span>
							{/if}
						</div>
						<div class="desc">
							{#if customEndpoint}
								Not available while "LiteLLM + Bedrock" is enabled — these modes are mutually
								incompatible.
							{:else}
								Pin which model <code>claude</code> uses on the standard (subscription) path. Only
								the fields you fill are injected into new containers as
								<code>ANTHROPIC_*_MODEL</code>
								variables; blanks fall through to Claude Code's own defaults.
							{/if}
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={manualModelOverride}
						disabled={savingManualModelToggle || customEndpoint}
						onchange={(e) => {
							manualModelOverride = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if manualModelToggleError}
				<div class="sub"><div class="msg error">{manualModelToggleError}</div></div>
			{/if}

			{#if manualModelOverride}
				<form
					class="row divided token-row"
					method="POST"
					action="?/manualModels"
					{@attach enhance(manualModelsOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Model IDs</div>
							<div class="desc">
								A model name or alias per tier, e.g. <code>opusplan</code>, <code>opus</code>,
								<code>sonnet</code>, or a full
								<code>claude-…</code> id. Leave a field blank to skip it.
							</div>
						</div>
					</div>
					<div class="model-fields">
						<label class="model-row">
							<span class="model-label">Opus</span>
							<input
								type="text"
								name="opusModel"
								class="image-input"
								bind:value={manualOpus}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Sonnet</span>
							<input
								type="text"
								name="sonnetModel"
								class="image-input"
								bind:value={manualSonnet}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Haiku</span>
							<input
								type="text"
								name="haikuModel"
								class="image-input"
								bind:value={manualHaiku}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Small/fast</span>
							<input
								type="text"
								name="smallFastModel"
								class="image-input"
								bind:value={manualSmallFast}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Default</span>
							<input
								type="text"
								name="defaultModel"
								class="image-input"
								bind:value={manualDefault}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<div class="model-save-row">
							<Button type="submit" disabled={savingManualModels}>Save models</Button>
						</div>
					</div>
					{#if manualModelsError}
						<div class="msg error">{manualModelsError}</div>
					{:else if manualModelsMsg}
						<div class="msg ok">{manualModelsMsg}</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card">
			<form
				class="row"
				method="POST"
				action="?/hostEnvVarsToggle"
				{@attach enhance(hostEnvVarsToggleOpts)}
			>
				<div class="label">
					<Variable size={20} />
					<div class="text">
						<div class="name">Host environment variables</div>
						<div class="desc">
							Forward selected environment variables from this machine into every new container's
							interactive shells. Values are read from this process's own environment at container
							start and are never shown here or stored — only the variable names are saved.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={hostEnvVars}
						disabled={savingHostEnvToggle}
						onchange={(e) => {
							hostEnvVars = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if hostEnvToggleError}
				<div class="sub"><div class="msg error">{hostEnvToggleError}</div></div>
			{/if}

			{#if hostEnvVars}
				<div class="row divided var-row">
					<div class="var-list">
						{#each hostEnvNames as name (name)}
							<form
								class="var-item"
								method="POST"
								action="?/hostEnvVarNames"
								{@attach enhance(removeHostEnvOpts(name))}
							>
								{#each hostEnvNames.filter((n) => n !== name) as other (other)}
									<input type="hidden" name="names" value={other} />
								{/each}
								<span class="var-name">{name}</span>
								<span
									class="var-status"
									class:present={hostEnvPresence[name]}
									title={hostEnvPresence[name]
										? 'Set on this host — will be injected'
										: 'Not set on this host — will be skipped'}
								>
									{hostEnvPresence[name] ? 'set' : 'missing'}
								</span>
								<button
									type="submit"
									class="var-remove"
									disabled={savingHostEnvNames}
									aria-label={`Remove ${name}`}
								>
									<X size={13} />
								</button>
							</form>
						{:else}
							<div class="var-empty">No variables added yet.</div>
						{/each}
					</div>
					<form
						class="var-add"
						method="POST"
						action="?/hostEnvVarNames"
						{@attach enhance(addHostEnvOpts)}
					>
						{#each hostEnvNames as name (name)}
							<input type="hidden" name="names" value={name} />
						{/each}
						<input
							type="text"
							name="names"
							class="image-input"
							bind:value={newHostEnvName}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder="AWS_ACCESS_KEY_ID"
						/>
						<Button type="submit" icon={Plus} disabled={savingHostEnvNames}>Add</Button>
					</form>
					{#if hostEnvNamesError}
						<div class="msg error">{hostEnvNamesError}</div>
					{:else if hostEnvNamesMsg}
						<div class="msg ok">{hostEnvNamesMsg}</div>
					{/if}
				</div>
			{/if}
		</section>

		<section class="card">
			<div class="row">
				<div class="label">
					<SunMoon size={20} />
					<div class="text">
						<div class="name">Theme</div>
						<div class="desc">
							Light, dark, or follow the browser preference automatically (auto).
						</div>
					</div>
				</div>
				<ThemePicker />
			</div>
		</section>

		<section class="card">
			<div class="row">
				<div class="label">
					<Volume2 size={20} />
					<div class="text">
						<div class="name">Attention sound</div>
						<div class="desc">
							Play a chime when an instance finishes a task or needs your input.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						checked={sound}
						onchange={(e) => toggleSound(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
		</section>

		<section class="card">
			<form class="row" method="POST" action="?/petToggle" {@attach enhance(petToggleOpts)}>
				<div class="label">
					<PawPrint size={18} />
					<div class="text">
						<div class="name">Pet logo</div>
						<div class="desc">Swap the box in the header for a pixel pet.</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={!!petArt}
						disabled={savingPet}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if petError}
				<div class="sub"><div class="msg error">{petError}</div></div>
			{/if}
			{#if petArt}
				<div class="sub pets">
					{#each avatars as art (art.name)}
						<form method="POST" action="?/petChoose" {@attach enhance(petChooseOpts(art))}>
							<input type="hidden" name="name" value={art.name} />
							<button
								type="submit"
								class="pet"
								class:selected={art.name === petArt.name}
								disabled={savingPet}
								title={art.name}
								aria-label={art.name}
								aria-pressed={art.name === petArt.name}
							>
								<Avatar {art} name={art.name} scale={4} />
							</button>
						</form>
					{/each}
				</div>
			{/if}
		</section>

		<section class="card">
			<details class="advanced">
				<summary>
					<SlidersHorizontal size={20} />
					<span class="name">Advanced</span>
					<span class="hint">escape hatches — defaults are right for almost everyone</span>
				</summary>

				<form
					class="row divided"
					method="POST"
					action="?/serialInjectionsToggle"
					{@attach enhance(serialOpts)}
				>
					<div class="label">
						<ListOrdered size={20} />
						<div class="text">
							<div class="name">Serial boot injections</div>
							<div class="desc">
								Run boot injections one at a time instead of in parallel stages. Slower boot; useful
								when diagnosing injection interference.
							</div>
						</div>
					</div>
					<label class="switch">
						<input
							type="checkbox"
							name="enabled"
							checked={serialInjections}
							disabled={savingSerial}
							onchange={(e) => {
								serialInjections = e.currentTarget.checked;
								e.currentTarget.form?.requestSubmit();
							}}
						/>
						<span class="track"><span class="thumb"></span></span>
					</label>
				</form>
				{#if serialError}
					<div class="sub"><div class="msg error">{serialError}</div></div>
				{/if}

				<form
					class="row divided"
					method="POST"
					action="?/noBuildkitToggle"
					{@attach enhance(buildkitOpts)}
				>
					<div class="label">
						<Boxes size={20} />
						<div class="text">
							<div class="name">Don't force BuildKit</div>
							<div class="desc">
								Skip setting <code>DOCKER_BUILDKIT=1</code> for container builds and let the daemon's
								default builder decide. For daemons where forcing BuildKit breaks builds.
							</div>
						</div>
					</div>
					<label class="switch">
						<input
							type="checkbox"
							name="enabled"
							checked={noBuildkit}
							disabled={savingBuildkit}
							onchange={(e) => {
								noBuildkit = e.currentTarget.checked;
								e.currentTarget.form?.requestSubmit();
							}}
						/>
						<span class="track"><span class="thumb"></span></span>
					</label>
				</form>
				{#if buildkitError}
					<div class="sub"><div class="msg error">{buildkitError}</div></div>
				{/if}

				<form
					class="row divided"
					method="POST"
					action="?/blockingExtInstallToggle"
					{@attach enhance(blockingOpts)}
				>
					<div class="label">
						<Puzzle size={20} />
						<div class="text">
							<div class="name">Blocking IDE extension install</div>
							<div class="desc">
								Install the Claude Code IDE extension before code-server starts, so the first window
								always has it active. Slower first boot.
							</div>
						</div>
					</div>
					<label class="switch">
						<input
							type="checkbox"
							name="enabled"
							checked={blockingExtInstall}
							disabled={savingBlocking}
							onchange={(e) => {
								blockingExtInstall = e.currentTarget.checked;
								e.currentTarget.form?.requestSubmit();
							}}
						/>
						<span class="track"><span class="thumb"></span></span>
					</label>
				</form>
				{#if blockingError}
					<div class="sub"><div class="msg error">{blockingError}</div></div>
				{/if}

				<form
					class="row divided"
					method="POST"
					action="?/clearVersionCache"
					{@attach enhance(clearVersionOpts)}
				>
					<div class="label">
						<Trash2 size={20} />
						<div class="text">
							<div class="name">Clear claude-code version cache</div>
							<div class="desc">
								Forget the cached latest-version check; the next instance boot asks the npm registry
								again.
							</div>
							{#if verError}
								<div class="msg error">{verError}</div>
							{:else if verMsg}
								<div class="msg ok">{verMsg}</div>
							{/if}
						</div>
					</div>
					<Button type="submit" icon={Trash2} disabled={clearingVer}>
						{clearingVer ? 'Clearing…' : 'Clear cache'}
					</Button>
				</form>
			</details>
		</section>

		<section class="card danger-card">
			<form class="row" method="POST" action="?/shutdown" {@attach enhance(shutdownOpts)}>
				<div class="label">
					<Power size={20} />
					<div class="text">
						<div class="name">Delete database, containers, and shut down</div>
						<div class="desc">
							Stop and remove every instance and its container, delete all copied workspaces and the
							database, then shut down the server. This cannot be undone.
						</div>
					</div>
				</div>
				{#if shuttingDown}
					<span class="shutting">Server is shutting down — you can close this tab.</span>
				{:else}
					<Button type="submit" variant="danger">Delete &amp; shut down</Button>
				{/if}
			</form>
		</section>

		<CoinButton />

		<div class="version">Codebay v{version}</div>
	</main>
</div>

<!-- Settings renders outside AppShell, which hosts the app-wide Toaster. -->
<Toaster
	toastOptions={{
		style:
			'border:1px solid var(--ink); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--ink); font-family:var(--font-mono); font-size:13px;'
	}}
/>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	.title {
		display: inline-flex;
		align-items: center;
		padding: 0 14px;
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 32px 20px;
	}
	.card {
		width: 100%;
		max-width: 560px;
		background: var(--bg-card);
		border: 1px solid var(--rule);
		height: max-content;
	}
	.danger-card {
		border-color: var(--danger);
	}
	details.advanced > summary {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		cursor: pointer;
		list-style: none;
		font-family: var(--font-mono);
	}
	details.advanced > summary::-webkit-details-marker {
		display: none;
	}
	details.advanced > summary .name {
		font-size: 13px;
	}
	details.advanced > summary .hint {
		color: var(--ink-soft);
		font-size: 12px;
	}
	/* The chevron affordance a hidden native marker would otherwise provide. */
	details.advanced > summary::after {
		content: '▸';
		margin-left: auto;
		color: var(--ink-soft);
	}
	details.advanced[open] > summary::after {
		content: '▾';
	}
	.disabled-card {
		opacity: 0.55;
		pointer-events: none;
	}
	/* Keep the action button on one line; in the flex row it would otherwise shrink and wrap. */
	.danger-card :global(.btn) {
		flex: none;
		white-space: nowrap;
	}
	.version {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	.shutting {
		flex: none;
		max-width: 200px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
		line-height: 1.4;
		text-align: right;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 18px;
	}
	.row.divided {
		border-top: 1px solid var(--rule);
		align-items: flex-start;
	}
	.row.divided :global(.btn) {
		flex: none;
		white-space: nowrap;
	}
	.sub {
		padding: 0 18px 14px;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		padding: 1px 4px;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 3px;
	}
	.label {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		color: var(--ink);
		min-width: 0;
	}
	/* Keep the leading icon at its intrinsic size; the flex row would otherwise shrink busier glyphs below 18px. */
	.label > :global(svg) {
		flex: none;
	}
	.text {
		min-width: 0;
	}
	.name {
		font-family: var(--font-mono);
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.arch {
		margin-left: 8px;
		padding: 2px 6px;
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		border: 1px solid var(--rule);
		border-radius: 3px;
		vertical-align: middle;
	}
	.tip {
		width: 100%;
		margin-top: 4px;
		padding: 8px 10px;
		color: var(--ink-soft);
		background: color-mix(in srgb, var(--info) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--info) 35%, transparent);
		border-radius: 4px;
	}
	.desc {
		margin-top: 4px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
		line-height: 1.4;
	}
	.image-row {
		flex-wrap: wrap;
	}
	/* Manual-token rows: same input+Save layout, allowed to wrap so the help text and
	   the "Saved." message drop below the field on narrow widths. */
	.token-row {
		flex-wrap: wrap;
	}
	.image-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 220px;
		justify-content: flex-end;
	}
	.image-input {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--rule);
	}
	.image-input:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 1px;
	}
	.image-controls :global(.btn) {
		flex: none;
	}
	.msg {
		width: 100%;
		margin-top: 2px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.4;
	}
	.msg.error {
		color: var(--danger);
	}
	.msg.ok {
		color: var(--ink-soft);
	}
	/* auto-fill so the grid reflows as the catalog grows, with no column count to keep in sync. */
	.pets {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
		gap: 6px;
	}
	/* Each pet is wrapped in its own form; let the button stay the grid item. */
	.pets form {
		display: contents;
	}
	.pet:disabled {
		cursor: progress;
	}
	.pet {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		appearance: none;
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
	}
	.pet:hover {
		border-color: var(--rule);
	}
	.pet.selected {
		border-color: var(--attn-done);
		background: var(--switch-on-bg);
	}
	.pet:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 1px;
	}
	.mode-toggle {
		display: flex;
		flex: none;
		border: 1px solid var(--ink);
	}
	.mode-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 7px 14px;
		border: none;
		background: var(--bg);
		color: var(--ink);
		cursor: pointer;
	}
	.mode-btn + .mode-btn {
		border-left: 1px solid var(--ink);
	}
	.mode-btn.active {
		background: var(--ink);
		color: var(--bg);
	}
	.mode-btn:disabled {
		cursor: not-allowed;
	}
	.switch {
		position: relative;
		flex: none;
		cursor: pointer;
	}
	.switch input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.track {
		display: block;
		width: 44px;
		height: 24px;
		border: 1px solid var(--rule);
		background: var(--bg);
		border-radius: 999px;
		transition: background 0.15s ease;
	}
	.thumb {
		display: block;
		width: 18px;
		height: 18px;
		margin: 2px;
		background: var(--ink-faint);
		border-radius: 999px;
		transition:
			transform 0.15s ease,
			background 0.15s ease;
	}
	.switch input:checked + .track {
		background: var(--switch-on-bg);
	}
	.switch input:checked + .track .thumb {
		transform: translateX(20px);
		background: var(--ink);
	}
	.switch input:focus-visible + .track {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	.model-fields {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 220px;
	}
	.model-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.model-label {
		flex: none;
		width: 72px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-soft);
		text-align: right;
	}
	.model-row .image-input {
		flex: 1;
	}
	.model-save-row {
		display: flex;
		justify-content: flex-end;
		margin-top: 4px;
	}
	.var-row {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
	}
	.var-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.var-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--bg);
		border: 1px solid var(--rule);
	}
	.var-name {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		word-break: break-all;
	}
	.var-status {
		flex: none;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--danger);
	}
	.var-status.present {
		color: var(--ink-soft);
	}
	.var-remove {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		color: var(--ink-soft);
		background: transparent;
		border: 1px solid var(--rule);
		cursor: pointer;
	}
	.var-remove:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
	}
	.var-remove:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.var-empty {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
	}
	.var-add {
		display: flex;
		gap: 8px;
	}
	.var-add :global(.btn) {
		flex: none;
	}
</style>
