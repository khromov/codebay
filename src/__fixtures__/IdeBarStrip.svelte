<!-- Renders the IDE tab strip with a stop button per tab for src/index.isolated.test.ts. -->
<script lang="ts">
	import IdeBar from '../components/IdeBar.svelte';
	import type { Instance } from '../types.ts';

	const tab = (id: string): Instance => ({
		id,
		name: id,
		source_path: `/src/${id}`,
		workspace_path: `/data/${id}`,
		host_port: 8001,
		container_id: null,
		remote_workspace_folder: null,
		status: 'running',
		error: null,
		created_at: 0,
		image_source: null,
		avatar: null,
		mode: 'ide',
		terminal_split: 0,
		git_branch: null,
		attention: null,
		forwarded_ports: [],
		active_run: null
	});

	let editingName = $state('');
</script>

<IdeBar
	running={[tab('alpha'), tab('beta')]}
	active="beta"
	attention={{}}
	editingId={null}
	bind:editingName
	onselect={() => {}}
	onstop={() => {}}
	onstartrename={() => {}}
	oncommitrename={() => {}}
	oncancelrename={() => {}}
/>
