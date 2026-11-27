<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { iconLibrary } from '../../glyphs/src/api'
  import { BRANDS, viewport } from '../../ui-kit/src/api'
  import { deviceName, dur, fade, fly } from '../../platform/src/api'
  import { trap } from '../../ui-controls/src/api'
  import { Ground } from '../../sign-in/src/api'
  import AccountStep from './AccountStep.svelte'
  import AiStep from './AiStep.svelte'
  import AppearanceStep from './AppearanceStep.svelte'
  import BrowserStep from './BrowserStep.svelte'
  import CodeStep from './CodeStep.svelte'
  import HeardStep from './HeardStep.svelte'
  import { continuesOn, phoneFirst, phoneName, worksAlone } from './flow'
  import ImportStep from './ImportStep.svelte'
  import McpStep from './McpStep.svelte'
  import MobileStep from './MobileStep.svelte'
  import NotesStep from './NotesStep.svelte'
  import { gate } from './gate.svelte'
  import { setup } from './setup-state.svelte'
  import WelcomeStep from './WelcomeStep.svelte'

  const SCREENS = {
    account: AccountStep,
    appearance: AppearanceStep,
    heard: HeardStep,
    browser: BrowserStep,
    import: ImportStep,
    notes: NotesStep,
    code: CodeStep,
    ai: __AI__ ? AiStep : WelcomeStep,
    mcp: McpStep,
    welcome: WelcomeStep,
  }
  const { app = __ORDEN_APP__ }: { app?: typeof __ORDEN_APP__ } = $props()
  setup.resume()
  onMount(() => {
    gate.letGo()
    iconLibrary.load(BRANDS)
    void setup.look()
  })
  const elsewhere = $derived(continuesOn(viewport.device, deviceName()))
  const signsIn = $derived(elsewhere !== null && phoneFirst(app) === 'sign-in')
  const Shown = $derived(SCREENS[setup.step])
  const wide = $derived(elsewhere !== null || setup.step === 'account' || setup.step === 'welcome')
  const way = $derived(setup.forward ? 1 : -1)
</script>

<div
  class="setup"
  data-covers="all"
  data-step={signsIn ? 'account' : elsewhere ? 'mobile' : setup.step}
  role="dialog"
  aria-modal="true"
  aria-label="Orden"
  use:trap
  transition:fade={{ duration: dur(500) }}
>
  <Ground {wide}>
    {#if signsIn}
      <div class="stage"><AccountStep phone alone={worksAlone(app)} name={phoneName(app)} /></div>
    {:else if elsewhere}
      <div class="stage"><MobileStep device={elsewhere} /></div>
    {:else}
      {#key setup.step}
        <div
          class="stage"
          in:fly={{ x: way * 60, duration: dur(550), delay: dur(80), easing: cubicOut }}
          out:fly={{ x: way * -60, duration: dur(450), easing: cubicOut }}
        >
          <Shown />
        </div>
      {/key}
    {/if}
  </Ground>
</div>

<style>
  .setup {
    position: fixed;
    inset: 0;
    z-index: var(--z-stage);
    overflow: clip;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    -webkit-font-smoothing: antialiased;
    transition:
      background-color 0.5s var(--ease-out),
      color 0.5s var(--ease-out);
  }
  .stage {
    position: absolute;
    inset: 0;
  }
  .setup :global(.pane-in) {
    animation: pane-in 0.45s var(--ease-out) both;
  }
  @keyframes pane-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
  }
  .setup :global(.o-pane) {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .setup :global(.o-grid) {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
  }
  .setup :global(.o-scroll) {
    max-height: min(40vh, 330px);
    overflow-y: auto;
    padding: 4px 4px 28px;
    margin: -4px;
    mask-image: linear-gradient(#000 calc(100% - 28px), transparent);
  }
  .setup :global(.o-end) {
    margin-inline-start: auto;
    min-width: 74px;
    min-height: 30px;
    display: inline-grid;
    place-items: center;
  }
  .setup :global(.o-done) {
    margin-inline-start: auto;
    min-width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    flex: none;
    color: var(--success);
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
  }
  .setup :global(.o-done svg) {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .setup :global(.o-list) {
    width: 100%;
    border-radius: 14px;
    background: var(--card);
    box-shadow:
      var(--shadow-sm),
      0 8px 24px rgb(16 24 40 / 0.08);
    overflow: hidden;
  }
  .setup :global(.o-list > *) {
    position: relative;
  }
  .setup :global(.o-list > :not(:first-child)::before) {
    content: '';
    position: absolute;
    top: 0;
    inset-inline: 16px 0;
    height: 1px;
    background: var(--line);
  }
  .setup :global(.o-row) {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border: 0;
    font: inherit;
    font-size: 15px;
    color: var(--text);
    text-align: start;
  }
  .setup :global(button.o-row) {
    cursor: pointer;
  }
  .setup :global(.o-toggle) {
    width: 44px;
    height: 26px;
    border-radius: 999px;
    background: var(--line-strong);
    position: relative;
    margin-inline-start: auto;
    flex: none;
    transition: background 0.25s var(--ease-out);
  }
  .setup :global(.o-toggle::after) {
    content: '';
    position: absolute;
    top: 3px;
    inset-inline-start: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    transition: transform 0.3s var(--ease-spring);
  }
  .setup :global([aria-checked='true'] > .o-toggle) {
    background: #34c759;
  }
  .setup :global([aria-checked='true'] > .o-toggle::after) {
    transform: translateX(18px);
  }
  @media (max-width: 640px) {
    .setup :global(.o-grid) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .setup :global(.pane-in) {
      animation: none;
    }
  }
</style>
