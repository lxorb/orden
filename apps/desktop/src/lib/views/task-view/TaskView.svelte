<script lang="ts">
  /** The one task view on the page, put there the first time a task is opened
   *  (viewing.svelte.ts). What it shows is held while it leaves, so the view slides
   *  away showing the task it was rather than nothing. */
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
