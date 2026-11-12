<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../motion'
  import type { Thread } from '../chat/types'
  import Rewind from './Rewind.svelte'
  import { review, type ReviewPanel } from './review.svelte'

  const { thread, panel = null }: { thread: Thread; panel?: ReviewPanel | null } = $props()

  const sheet = $derived(review.sheet?.thread.id === thread.id ? review.sheet : null)
  const redo = $derived(review.canRedo(thread))
</script>

{#if sheet}
  <Rewind {sheet} />
{:else if redo}
  <div class="redo" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    <button class="orden-chip is-quiet" onclick={() => void review.putBack(thread, panel)}
      >Redo</button
    >
  </div>
{/if}

<style>
  .redo {
    display: flex;
    justify-content: flex-end;
  }
</style>
