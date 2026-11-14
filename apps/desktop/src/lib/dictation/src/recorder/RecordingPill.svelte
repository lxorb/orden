<script lang="ts">
  import { recorder } from './recording.svelte'
  import { spanOf } from './transcript'
</script>

{#if recorder.on || recorder.saving}
  <div class="orden-bar recording" class:saving={!recorder.on}>
    <span class="dot"></span>
    <span class="clock">{spanOf(recorder.elapsed)}</span>
    <button
      title="Stop recording"
      aria-label="Stop recording"
      disabled={!recorder.on}
      onclick={() => recorder.toggle()}
    >
      <svg viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" rx="1" /></svg>
    </button>
  </div>
{/if}

<style>
  .recording {
    grid-column: 2;
    align-items: center;
    gap: var(--space-2);
    padding-inline-start: var(--space-3);
    animation: pill-in var(--dur-base) var(--ease-spring);
  }

  :global([data-touch]) .recording {
    grid-column: 1;
    justify-self: center;
  }

  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-3));
    }
  }

  .recording.saving {
    opacity: 0.75;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    animation: pill-beat 1.8s var(--ease-in-out) infinite;
  }

  .recording.saving .dot {
    background: var(--muted);
    animation: none;
  }

  @keyframes pill-beat {
    50% {
      opacity: 0.35;
    }
  }

  .clock {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted-strong);
  }

  .recording svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .dot,
    .recording {
      animation: none;
    }
  }
</style>
