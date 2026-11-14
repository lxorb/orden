<script lang="ts">
  import { pull, REACH } from './pull.svelte'
  import { stillness } from './platform/src/api'
  import { nameFor } from './toolbar.svelte'

  const waiting = $derived(pull.refreshing || pull.failed)
  const at = $derived(waiting ? REACH : pull.at)
  const ready = $derived(pull.ready)
  const said = $derived(
    pull.refreshing ? 'Syncing' : pull.failed ? 'Sync failed' : nameFor('app.refresh'),
  )
  const part = $derived(Math.min(1, at / REACH))
  const still = stillness()
</script>

{#if at > 0}
  <div
    class="pull"
    data-covers
    role="status"
    aria-label={said}
    style:--at="{Math.round(at)}px"
    style:--part={still || waiting ? 1 : part}
    class:ready={ready && !waiting}
    class:turning={pull.refreshing && !still}
    class:failed={pull.failed}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle class="track" cx="12" cy="12" r="10.5" />
      <circle class="filling" cx="12" cy="12" r="10.5" />
      <path class="arrow" d="M16.2 12a4.2 4.2 0 1 1-1.23-2.97L16.2 10.3M16.2 7.5v2.8h-2.8" />
    </svg>
  </div>
{/if}

<style>
  .pull {
    position: fixed;
    top: calc(var(--header-height) + var(--inset-top));
    left: 50%;
    translate: -50% calc(var(--at) - 50%);
    z-index: var(--z-float);
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--surface-3);
    box-shadow: var(--shadow-sm);
    pointer-events: none;
  }

  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    rotate: 0deg;
  }

  .track {
    stroke: var(--line-strong);
  }

  .filling {
    stroke: var(--accent);
    stroke-dasharray: 66;
    stroke-dashoffset: calc(66 - 66 * var(--part));
    rotate: -90deg;
    transform-origin: 50% 50%;
  }

  .arrow {
    stroke: var(--muted-strong);
  }

  .ready {
    background: var(--accent);
  }

  .ready .track,
  .ready .filling {
    stroke: transparent;
  }

  .ready .arrow {
    stroke: var(--accent-ink);
  }

  .turning .filling {
    stroke-dashoffset: 49;
    animation: turn 0.9s linear infinite;
  }

  .turning .arrow {
    stroke: transparent;
  }

  .failed .filling {
    stroke: var(--danger);
  }

  @media (prefers-reduced-motion: reduce) {
    .turning .filling {
      animation: none;
    }
  }

  @keyframes turn {
    to {
      rotate: 270deg;
    }
  }
</style>
