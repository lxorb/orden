<script lang="ts">
  import { fullscreen } from './fullscreen.svelte'
</script>

<button
  class="leave"
  data-covers
  class:idle={fullscreen.idle}
  title="Leave fullscreen"
  aria-label="Leave fullscreen"
  onclick={() => void fullscreen.leave()}
>
  <svg viewBox="0 0 16 16">
    <path d="M6.5 2.5v4h-4M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 13.5v-4h4" />
  </svg>
</button>

<style>
  .leave {
    position: absolute;
    top: max(var(--space-2), var(--inset-top));
    inset-inline-end: max(var(--space-2), var(--inset-right));
    z-index: var(--z-float);
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-3) 82%, transparent);
    color: var(--muted-strong);
    box-shadow: var(--shadow-sm);
    cursor: default;
    width: var(--leave-size);
    height: var(--leave-size);
    transition:
      opacity var(--dur-slow) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
    animation: arrive var(--dur-base) var(--ease-out);
  }

  @keyframes arrive {
    from {
      opacity: 0;
    }
  }

  .leave.idle {
    opacity: 0.22;
  }

  @media (hover: hover) {
    .leave:hover {
      opacity: 1;
      background: var(--surface-3);
      color: var(--text-strong);
    }
  }

  .leave:active {
    opacity: 1;
    background: var(--press);
    color: var(--text-strong);
  }

  .leave:focus-visible {
    opacity: 1;
    outline-offset: 2px;
  }

  .leave svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  :global([data-touch]) .leave svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
  }
</style>
