<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { shownSite } from './idn'
  import { dur, fly } from '../platform/src/api'
  import { overlays } from '../overlays'
  import { takeKeyboard } from '../take-keyboard'
  import { isDesktop } from '../platform/src/api'
  import type { Asking } from './permissions.svelte'
  import { grants } from './permissions.svelte'

  const { asking, icon }: { asking: Asking; icon: string | null } = $props()

  const WANTS: Record<Asking['ask'], () => string> = {
    camera: () => 'Use your camera',
    microphone: () => 'Use your microphone',
    location: () => 'Know your location',
    notifications: () => 'Show notifications',
    clipboard: () => 'See text and images copied to the clipboard',
    sensors: () => 'Use your motion sensors',
    downloads: () => 'Download multiple files',
    fonts: () => 'Use fonts installed on your device',
    midi: () => 'Use your MIDI devices',
    windows: () => 'Manage windows on all your displays',
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
  class="ask orden-bubble is-pressable orden-host"
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
    <span><strong>{shownSite(asking.site)}</strong> wants to</span>
  </p>
  <p class="which">{WANTS[asking.ask]()}</p>

  <div class="rows">
    <button class="orden-button is-quiet" onclick={() => grants.answer(asking, false)}>
      Don’t allow
    </button>
    <button class="orden-button" onclick={() => grants.answer(asking, true)}>Allow</button>
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
