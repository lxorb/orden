<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { iconLibrary } from '../icon-library.svelte'
  import { BRANDS } from '../icons'
  import { i18n } from '../i18n.svelte'
  import { dur, fade, fly } from '../motion'
  import { trap } from '../trap'
  import AccountStep from './AccountStep.svelte'
  import AiStep from './AiStep.svelte'
  import AppearanceStep from './AppearanceStep.svelte'
  import BrowserStep from './BrowserStep.svelte'
  import CodeStep from './CodeStep.svelte'
  import HeardStep from './HeardStep.svelte'
  import ImportStep from './ImportStep.svelte'
  import NotesStep from './NotesStep.svelte'
  import { setup } from './setup.svelte'
  import WelcomeStep from './WelcomeStep.svelte'

  const SCREENS = {
    account: AccountStep,
    appearance: AppearanceStep,
    heard: HeardStep,
    browser: BrowserStep,
    import: ImportStep,
    notes: NotesStep,
    code: CodeStep,
    ai: AiStep,
    welcome: WelcomeStep,
  }

  onMount(() => {
    iconLibrary.load(BRANDS)
    void setup.look()
  })

  const Shown = $derived(SCREENS[setup.step])
  const wide = $derived(setup.step === 'account' || setup.step === 'welcome')
  const shift = $derived((setup.forward ? 60 : -60) * i18n.factor)
</script>

<div
  class="setup"
  class:wide
  data-step={setup.step}
  role="dialog"
  aria-modal="true"
  aria-label="Orden"
  use:trap
  out:fade={{ duration: dur(500) }}
>
  <div class="aura" aria-hidden="true"></div>
  {#key setup.step}
    <div
      class="stage"
      in:fly={{ x: shift, duration: dur(550), delay: dur(80), easing: cubicOut }}
      out:fly={{ x: -shift, duration: dur(450), easing: cubicOut }}
    >
      <Shown />
    </div>
  {/key}
</div>

<style>
  .setup {
    --glow-a: #1b2a44;
    --glow-b: #33203d;
    --glow-c: #221f45;
    --card: var(--surface);
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

  :global([data-theme='light']) .setup {
    --glow-a: #c9ddf8;
    --glow-b: #ecd1f1;
    --glow-c: #dcd6fb;
    --card: #fff;
  }

  .aura {
    position: absolute;
    inset: -20%;
    pointer-events: none;
    opacity: 0.45;
    background:
      radial-gradient(40% 45% at 22% 18%, var(--glow-a), transparent 70%),
      radial-gradient(38% 42% at 82% 82%, var(--glow-b), transparent 70%),
      radial-gradient(30% 35% at 70% 20%, var(--glow-c), transparent 70%);
    filter: blur(10px);
    animation: drift 22s ease-in-out infinite alternate;
    transition: opacity 0.8s var(--ease-out);
  }

  .wide .aura {
    opacity: 1;
  }

  @keyframes drift {
    to {
      transform: translate3d(3%, -2%, 0) rotate(6deg) scale(1.05);
    }
  }

  .stage {
    position: absolute;
    inset: 0;
  }

  .setup :global(.rise) {
    animation: rise 0.6s var(--ease-out) both;
  }

  .setup :global(.rise:nth-child(2)) {
    animation-delay: 0.06s;
  }

  .setup :global(.rise:nth-child(3)) {
    animation-delay: 0.12s;
  }

  .setup :global(.rise:nth-child(4)) {
    animation-delay: 0.18s;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
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

  .setup :global(.o-list > * + *::before) {
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
    background: none;
    font: inherit;
    font-size: 15px;
    color: var(--text);
    text-align: start;
  }

  .setup :global(button.o-row) {
    cursor: pointer;
  }

  .setup :global(button.o-row:hover) {
    background: var(--surface-2);
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
    transform: translateX(calc(18px * var(--dir, 1)));
  }

  @media (max-width: 640px) {
    .setup :global(.o-grid) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .aura,
    .setup :global(.rise),
    .setup :global(.pane-in) {
      animation: none;
    }
  }
</style>
