<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { accentFor } from '../../accents'
  import { initial } from '../../icons'
  import { dur, fly } from '../../platform/src/api'
  import { overlays } from '../../overlays'
  import { theme } from '../../theme/src/api'
  import type { Vault } from './vault.svelte'

  const { vault }: { vault: Vault } = $props()

  const asking = $derived(vault.asking[0] ?? null)
  const device = $derived(asking?.name ?? '')

  let card = $state<HTMLElement>()

  $effect(() => {
    const one = asking
    if (!one) return
    return overlays.show(() => {
      vault.dismiss(one.id)
    })
  })

  onMount(() => {
    card?.focus({ preventScroll: true })
  })
</script>

{#if asking}
  <div
    class="approve orden-bubble is-pressable orden-host"
    role="dialog"
    aria-label="{device} wants your AI accounts"
    tabindex="-1"
    bind:this={card}
    transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
  >
    <p class="what">
      <span
        class="orden-badge"
        style:--badge-fill={accentFor(device, theme.current)}
        style:--badge-ink="var(--accent-ink)"
        aria-hidden="true">{initial(device)}</span
      >
      <span class="device">{device} wants your AI accounts</span>
      <span class="digits">{asking.digits}</span>
    </p>
    <div class="rows">
      <button class="orden-button is-quiet" onclick={() => void vault.deny(asking.id)}>
        Don’t allow
      </button>
      <button class="orden-button" onclick={() => void vault.allow(asking.id)}>Allow</button>
    </div>
  </div>
{/if}

<style>
  .approve {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-2));
    inset-inline-end: var(--space-3);
    z-index: var(--z-notice);
    width: min(22rem, calc(100vw - var(--space-6)));
    max-width: none;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  .device {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .digits {
    flex: none;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
