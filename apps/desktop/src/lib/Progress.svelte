<script lang="ts">
  import { busy } from './busy.svelte'

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
    <div class="run"></div>
  </div>
{/if}

<style>
  /* Along the top edge of the document, under the tabs: the thinnest thing
     that can still be seen moving. */
  .track {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 15;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
    animation: fade-in var(--dur-fast) var(--ease-out);
  }

  .run {
    width: 34%;
    height: 100%;
    border-radius: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 1150ms var(--ease-in-out) infinite;
  }

  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  /* Movement is the point, so with movement turned down the line simply sits
     there: still a sign that something is running. */
  @media (prefers-reduced-motion: reduce) {
    .run {
      width: 100%;
      animation: none;
      background: var(--accent);
      opacity: 0.5;
    }
  }
</style>
