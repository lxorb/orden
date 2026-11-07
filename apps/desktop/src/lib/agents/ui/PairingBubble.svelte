<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { accentFor } from '../../accents'
  import { t } from '../../i18n.svelte'
  import { initial } from '../../icons'
  import { dur, fly } from '../../motion'
  import { overlays } from '../../overlays'
  import { takeKeyboard } from '../../take-keyboard'
  import { isDesktop } from '../../tauri'
  import { theme } from '../../theme.svelte'
  import type { Activity } from './activity.svelte'

  const { activity }: { activity: Activity } = $props()

  const asking = $derived(activity.seen.approvals.find((one) => one.category === 'pairing') ?? null)
  const client = $derived(asking?.summary ?? '')

  let card = $state<HTMLElement>()

  function answer(allow: boolean) {
    if (asking) void activity.answer(asking, allow).catch(() => undefined)
  }

  $effect(() => overlays.show(() => answer(false)))

  onMount(() => {
    card?.focus({ preventScroll: true })
    if (isDesktop && !document.hasFocus()) void takeKeyboard()
  })
</script>

{#if asking}
  <div
    class="pairing orden-bubble is-pressable orden-host"
    role="dialog"
    aria-label={client}
    tabindex="-1"
    bind:this={card}
    transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
  >
    <p class="what">
      <span
        class="orden-badge"
        style:--badge-fill={accentFor(client, theme.current)}
        style:--badge-ink="var(--accent-ink)"
        aria-hidden="true">{initial(client)}</span
      >
      <span class="client">{t('{client} wants to connect', { client })}</span>
    </p>
    <div class="rows">
      <button class="orden-button is-quiet" onclick={() => answer(false)}>{t('Don’t allow')}</button
      >
      <button class="orden-button" onclick={() => answer(true)}>{t('Allow')}</button>
    </div>
  </div>
{/if}

<style>
  .pairing {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-2));
    inset-inline-end: var(--space-3);
    z-index: var(--z-notice);
    width: min(20rem, calc(100vw - var(--space-6)));
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

  .client {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
