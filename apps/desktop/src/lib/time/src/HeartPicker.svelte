<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import { hang, overlays } from '../../ui-kit/src/api'
  import { liveHeart, type Monitor } from './health-live.svelte'

  const { from, onclose }: { from: HTMLElement; onclose: () => void } = $props()
  let layer = $state<HTMLElement | null>(null)
  let found = $state<Monitor[] | null>(null)
  let looking = $state(false)
  let failed = $state<string | null>(null)
  $effect(() => overlays.show(onclose, () => [layer, from]))
  async function look() {
    looking = true
    failed = null
    try {
      found = await liveHeart.monitors()
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error)
      found = []
    } finally {
      looking = false
    }
  }
  $effect(() => {
    if (liveHeart.state === 'off') void look()
  })
</script>

<div
  class="picker orden-layer"
  data-covers
  data-time-heart
  bind:this={layer}
  use:hang={{ side: 'below', gap: 6, from }}
  transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}
>
  <p class="orden-section">Heart rate monitor</p>
  {#if liveHeart.state !== 'off'}
    <p class="said">
      {liveHeart.name ?? 'Your watch'}
      <span class="state"
        >{liveHeart.state === 'connected'
          ? `${String(liveHeart.bpm ?? '...')} bpm`
          : liveHeart.state === 'reconnecting'
            ? 'Reconnecting'
            : 'Connecting'}</span
      >
    </p>
    <button type="button" class="orden-row is-short" onclick={() => void liveHeart.disconnect()}>Disconnect</button>
  {:else}
    <p class="hint">On the watch, turn on Broadcast Heart Rate, then pick it here.</p>
    {#if looking}
      <p class="hint">Looking for monitors...</p>
    {:else if found?.length}
      {#each found as monitor (monitor.id)}
        <button
          type="button"
          class="orden-row is-short"
          data-heart-monitor
          onclick={() => {
            void liveHeart.connect(monitor)
          }}><span class="orden-row-label">{monitor.name ?? 'Heart rate monitor'}</span></button
        >
      {/each}
    {:else}
      <p class="hint">{failed ?? liveHeart.error ?? 'No monitor found.'}</p>
    {/if}
    <button type="button" class="orden-row is-short is-quiet" disabled={looking} onclick={() => void look()}
      >Look again</button
    >
  {/if}
</div>

<style>
  .picker {
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 18rem;
    padding: var(--space-2);
  }
  .orden-section {
    margin: 0 0 var(--space-1);
    padding: 0 var(--row-pad);
  }
  .hint,
  .said {
    margin: 0 0 var(--space-1);
    padding: 0 var(--row-pad);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .said {
    display: flex;
    justify-content: space-between;
    color: var(--text-strong);
  }
  .state {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
