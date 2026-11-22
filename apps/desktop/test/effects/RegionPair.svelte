<script lang="ts">
  import Region from '../../src/Region.svelte'
  import RegionThrower from './RegionThrower.svelte'
  import { held } from './region-state.svelte'
</script>

<Region name="left"><RegionThrower /></Region>
<Region name="right"><button class="right" onclick={() => (held.count += 1)}>{held.count}</button></Region>
