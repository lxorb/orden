<script lang="ts">
  import SoundMark from './SoundMark.svelte'
  import { spaceSets } from '../../workspace/src/api'

  const { id }: { id: string } = $props()
</script>

{#await spaceSets() then { sets }}
  {#if sets.playing.includes(id)}<SoundMark />{/if}
{/await}
