<script lang="ts">
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { shownSite } from './idn'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { takeKeyboard } from '../take-keyboard'
  import { isDesktop } from '../tauri'
  import type { Asking } from './permissions.svelte'
  import { grants } from './permissions.svelte'

  const { asking, icon }: { asking: Asking; icon: string | null } = $props()

  const WANTS: Record<Asking['ask'], () => string> = {
    camera: () => t('Use your camera'),
    microphone: () => t('Use your microphone'),
    location: () => t('Know your location'),
    notifications: () => t('Show notifications'),
    clipboard: () => t('See text and images copied to the clipboard'),
    sensors: () => t('Use your motion sensors'),
    downloads: () => t('Download multiple files'),
    fonts: () => t('Use fonts installed on your device'),
    midi: () => t('Use your MIDI devices'),
    windows: () => t('Manage windows on all your displays'),
  }

  let marked = $state(true)
  let card = $state<HTMLElement>()

  $effect(() => overlays.show(() => grants.dismiss(asking)))

  onMount(() => {
    card?.focus({ preventScroll: true })
    if (isDesktop && !document.hasFocus()) void takeKeyboard()
  })
</script>

<div
  class="ask nib-bubble is-pressable nib-host"
  role="dialog"
  aria-label={shownSite(asking.site)}
  tabindex="-1"
  bind:this={card}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  <p class="what">
    {#if icon && marked}
      <img class="mark" src={icon} alt="" draggable="false" onerror={() => (marked = false)} />
    {/if}
    <span><strong>{shownSite(asking.site)}</strong> {t('wants to')}</span>
  </p>
  <p class="which">{WANTS[asking.ask]()}</p>

  <div class="rows">
    <button class="nib-button is-quiet" onclick={() => grants.answer(asking, false)}>
      {t('Don’t allow')}
    </button>
    <button class="nib-button" onclick={() => grants.answer(asking, true)}>{t('Allow')}</button>
  </div>
</div>

<style>
  .ask {
    position: absolute;
    top: 100%;
    left: var(--space-2);
    z-index: var(--z-float);
    width: min(22rem, calc(100% - var(--space-4)));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: var(--radius-sm);
  }

  .which {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
