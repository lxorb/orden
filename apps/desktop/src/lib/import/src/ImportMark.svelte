<script lang="ts">
  import type { Tab } from '../../documents/src/api'
  import { readKept, runs } from './run.svelte'

  const { tab }: { tab: Tab } = $props()
  const run = $derived(runs.get(readKept(tab.doc)?.id ?? '') ?? null)
  const phase = $derived(run?.phase ?? 'interrupted')
  const failed = $derived(run?.tally.failed ?? 0)
  const RING = 2 * Math.PI * 5
</script>

<span class="mark" aria-hidden="true">
  <svg viewBox="0 0 14 14">
    {#if phase === 'review' && !failed}
      <circle cx="7" cy="7" r="6" class="good" />
      <path d="M4.3 7.2l1.8 1.8 3.6-3.7" class="ink" />
    {:else if phase === 'review' || phase === 'failed'}
      <circle cx="7" cy="7" r="6" class="bad" />
      <path d="M7 4v3.4" class="ink" />
      <circle cx="7" cy="9.9" r=".8" class="dot" />
    {:else if phase === 'interrupted'}
      <circle cx="7" cy="7" r="5.25" class="track" />
    {:else}
      <circle cx="7" cy="7" r="5" class="track" />
      <circle
        cx="7"
        cy="7"
        r="5"
        class="fill"
        stroke-dasharray={RING}
        stroke-dashoffset={RING * (1 - (run?.fraction ?? 0))}
        transform="rotate(-90 7 7)"
      />
    {/if}
  </svg>
</span>

<style>
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .track,
  .fill {
    fill: none;
    stroke-width: 2;
  }
  .track {
    stroke: var(--line-strong);
  }
  .fill {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset var(--dur-base) var(--ease-out);
  }
  .good {
    fill: var(--success);
  }
  .bad {
    fill: var(--danger);
  }
  .ink {
    fill: none;
    stroke: var(--accent-ink);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--accent-ink);
  }
</style>
