<script lang="ts">
  import SoundMark from './SoundMark.svelte'
  import { sets } from './workspace/src/sets.svelte'

  const { id }: { id: string } = $props()
</script>

{#if sets.playing.includes(id)}<SoundMark />{/if}
