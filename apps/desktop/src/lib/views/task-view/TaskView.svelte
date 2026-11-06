<script lang="ts">
  import TaskSheet from './TaskSheet.svelte'
  import { type Shown, viewing } from './viewing.svelte'

  let kept: Shown | null = null
  const held = $derived.by(() => {
    const now = viewing.shown
    if (now) kept = now
    return kept
  })
</script>

{#if viewing.shown && held}
  <TaskSheet shown={held} />
{/if}
