<script lang="ts">
  import { busy } from './busy.svelte'
  import Sweep from './Sweep.svelte'

  /** Held back for a moment, so work that finishes quickly never flashes a
   *  line at anyone. Anything slower than this was worth mentioning. */
  const DELAY = 200

  let showing = $state(false)

  $effect(() => {
    if (!busy.active) {
      showing = false
      return
    }

    const timer = setTimeout(() => (showing = true), DELAY)
    return () => clearTimeout(timer)
  })
</script>

{#if showing}
  <div class="track" role="status" aria-label={busy.label ?? undefined}>
    <Sweep />
  </div>
{/if}

<style>
  /* Along the top edge of the document, under the tabs. The line itself is
     Sweep.svelte, which the account's first sync draws as well. */
  .track {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 15;
    pointer-events: none;
    animation: fade-in var(--dur-fast) var(--ease-out);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
