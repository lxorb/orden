<script lang="ts">
  import { shortcuts } from '../shortcuts.svelte'
  import EngineChooser from './EngineChooser.svelte'
  import { HOLD } from './keys'
  import { type Dictates, voice } from './voice.svelte'

  const {
    owner,
    below = false,
  }: {
    owner: Dictates
    below?: boolean
  } = $props()

  const hearing = $derived(voice.of(owner))
  const asking = $derived(voice.asking === owner)
  let button = $state<HTMLButtonElement>()
  let pressed: { at: number; started: boolean } | null = null

  const title = $derived(
    hearing === 'finishing'
      ? 'Writing down what you said'
      : hearing === 'idle'
        ? shortcuts.tooltip('Dictate', 'field.dictate')
        : 'Stop dictating',
  )

  function down(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    pressed = { at: performance.now(), started: hearing === 'idle' }
    if (hearing === 'idle') void voice.start(owner)
  }

  function up() {
    const was = pressed
    pressed = null
    if (!was) return
    if (!was.started) void voice.finish()
    else if (performance.now() - was.at >= HOLD && voice.asking !== owner) void voice.finish()
  }

  function clicked(event: MouseEvent) {
    if (event.detail === 0) void voice.toggle(owner)
  }
</script>

<span class="dictate">
  <button
    bind:this={button}
    type="button"
    class="orden-glyph mic"
    class:listening={hearing === 'listening' || hearing === 'opening'}
    class:finishing={hearing === 'finishing'}
    style:--level={voice.owner === owner ? voice.level : 0}
    {title}
    aria-label={title}
    aria-pressed={hearing !== 'idle'}
    aria-haspopup={asking ? 'dialog' : undefined}
    disabled={hearing === 'finishing'}
    onpointerdown={down}
    onpointerup={up}
    onpointercancel={up}
    onclick={clicked}
  >
    <svg viewBox="0 0 13 13" aria-hidden="true"
      ><rect x="4.6" y="1.5" width="3.8" height="6.5" rx="1.9" /><path
        d="M2.8 6.2a3.7 3.7 0 0 0 7.4 0M6.5 9.9v1.8"
      /></svg
    >
  </button>
  {#if asking && button}
    <EngineChooser {owner} {button} {below} />
  {/if}
</span>

<style>
  .dictate {
    position: relative;
    flex: none;
    display: inline-grid;
  }

  .mic {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    border-radius: 50%;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .mic svg {
    width: 14px;
    height: 14px;
    stroke-width: 1.4;
  }

  .mic.listening,
  .mic.listening:hover {
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 0 0 calc(1px + var(--level) * 5px) var(--accent-line);
  }

  .mic.finishing {
    background: var(--accent-soft);
    color: var(--accent);
    animation: breathe calc(var(--dur-slow) * 3) var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mic.finishing {
      animation: none;
    }
  }

  :global([data-touch]) .mic {
    width: var(--row-height);
    height: var(--row-height);
  }
</style>
