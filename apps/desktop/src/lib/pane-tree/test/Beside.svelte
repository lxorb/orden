<script lang="ts">
  import { workspace } from '../../workspace/src/api'
  import PaneTree from '../src/PaneTree.svelte'
  import Before from './Before.svelte'
</script>

<Before />
<PaneTree frame={workspace.panes.frame} />
