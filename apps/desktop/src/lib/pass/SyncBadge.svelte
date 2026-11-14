<script lang="ts">
  import { localDate } from '../platform/src/api'
  import CloudOff from 'lucide/dist/esm/icons/cloud-off.mjs'
  import Cloud from 'lucide/dist/esm/icons/cloud.mjs'
  import RefreshCw from 'lucide/dist/esm/icons/refresh-cw.mjs'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import Glyph from './Glyph.svelte'
  import { pass } from './store.svelte'
  import { passSync } from './syncing.svelte'
  import { syncWord } from './sync-words'

  const { onadopt }: { onadopt: () => void } = $props()

  const state = $derived(passSync.state)
  const word = $derived(syncWord(state))
  const icon = $derived.by(() => {
    switch (state) {
      case 'syncing':
        return RefreshCw
      case 'synced':
      case 'off':
        return Cloud
      case 'offline':
        return CloudOff
      case 'old-server':
      case 'conflict':
      case 'other-account':
        return TriangleAlert
    }
  })
  const at = $derived(
    state === 'synced' && passSync.at !== null
      ? `Last synced ${localDate(passSync.at, { timeStyle: 'short' })}`
      : undefined,
  )
</script>

{#if pass.trustProblem}
  <p class="sync is-wrong" data-trust role="alert">
    <Glyph icon={TriangleAlert} />
    <span class="word">{pass.trustProblem}</span>
  </p>
{/if}
{#if word}
  {#if state === 'conflict'}
    <button class="sync is-pressable" type="button" data-sync={state} onclick={onadopt}>
      <Glyph {icon} />
      <span class="word">{word}</span>
    </button>
  {:else}
    <p class="sync" data-sync={state} title={at} role="status">
      <Glyph {icon} />
      <span class="word">{word}</span>
    </p>
  {/if}
{/if}

<style>
  .sync {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-1) var(--row-pad);
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    text-align: start;
  }

  .sync.is-wrong {
    color: var(--danger, var(--muted));
  }

  .sync :global(.glyph) {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .word {
    min-width: 0;
  }

  [data-sync='syncing'] :global(.glyph) {
    animation: turn 1.2s linear infinite;
  }

  [data-sync='old-server'],
  [data-sync='conflict'],
  [data-sync='other-account'] {
    color: var(--text-strong);
  }

  [data-sync='old-server'] :global(.glyph),
  [data-sync='conflict'] :global(.glyph),
  [data-sync='other-account'] :global(.glyph) {
    color: var(--callout-warning);
  }

  .is-pressable {
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .is-pressable:hover {
    background: var(--surface-hover);
  }

  @keyframes turn {
    to {
      rotate: 360deg;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-sync='syncing'] :global(.glyph) {
      animation: none;
    }
  }
</style>
