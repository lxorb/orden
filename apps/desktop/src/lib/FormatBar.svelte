<script lang="ts">
  import {
    selectedImage,
    toggleHighlight,
    type EditorView,
    type StateCommand,
    type Transaction,
  } from '@orden/editor'
  import { HIGHLIGHT_COLOURS, type HighlightColour } from '@orden/markdown/highlights'
  import type { IconNode } from 'lucide'
  import { keepFocus } from './focus'
  import { tick } from 'svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { roving } from './roving'
  import { type AppContext, runEntry } from './shortcuts/registry'
  import { shortcuts } from './shortcuts.svelte'
  import { glyphFor, lowMark, markFor, nameFor, toolbar } from './toolbar.svelte'
  import { viewport } from './viewport.svelte'

  const {
    view,
    context,
  }: {
    view?: EditorView | undefined
    context?: (() => AppContext) | undefined
  } = $props()

  let at = $state<{ x: number; y: number } | null>(null)

  let over: EditorView | null = null

  let bar = $state<HTMLElement>()
  let colouring = $state(false)

  const keys = { across: true, rows: 'button' } as const

  let writing = $state(false)

  $effect(() => {
    const note = view?.contentDOM
    let live = true
    const follow = () =>
      queueMicrotask(() => {
        if (!live) return
        const at = document.activeElement
        writing = !!note && (at === note || (!!at && !!bar?.contains(at)))
      })

    follow()
    document.addEventListener('focusin', follow)
    document.addEventListener('focusout', follow)
    return () => {
      live = false
      document.removeEventListener('focusin', follow)
      document.removeEventListener('focusout', follow)
    }
  })

  const docked = $derived(viewport.touch && viewport.typing && writing)

  $effect(() => {
    if (!docked) viewport.covered = 0
  })

  $effect(() => {
    if (view === over) return
    at = null
    colouring = false
  })

  $effect(() => {
    if (!docked && !at) colouring = false
  })

  export function follow(current: EditorView) {
    const range = current.state.selection.main

    const ours = bar?.contains(document.activeElement) ?? false

    if (
      range.empty ||
      (!current.hasFocus && !ours) ||
      current.state.readOnly ||
      selectedImage(current.state)
    ) {
      at = null
      colouring = false
      return
    }

    if (viewport.touch) {
      at = null
      return
    }

    const start = current.coordsAtPos(range.from)
    const end = current.coordsAtPos(range.to)
    if (!start || !end) {
      at = null
      return
    }

    const half = 150
    const middle = (start.left + end.right) / 2
    const x = Math.min(Math.max(middle, half), window.innerWidth - half)

    over = current
    at = { x, y: Math.min(start.top, end.top) }
  }

  function run(command: StateCommand) {
    if (!view) return
    command({ state: view.state, dispatch: (t: Transaction) => view.dispatch(t) })
    view.focus()
  }

  function act(id: string) {
    runEntry(
      id,
      context?.() ?? { view, palette: () => undefined, fullscreen: () => undefined },
      'button',
    )
  }

  const HIGHLIGHT = 'format.highlight'

  const held = $derived(toolbar.ids)

  const dotFor = (tone: number | null) => (tone === null ? undefined : `var(--canvas-${tone})`)

  async function showColours(on: boolean) {
    const keyboard = bar?.contains(document.activeElement) ?? false
    colouring = on
    if (!keyboard) return

    await tick()
    bar?.querySelector<HTMLElement>('button.swatch')?.focus()
  }

  function pick(colour: HighlightColour) {
    modes.setHighlightTone(colour.tone)
    colouring = false
    run(toggleHighlight(colour))
  }
</script>

{#snippet press(
  title: string,
  label: string,
  act: () => void,
  glyph: IconNode | null = null,
  low = false,
  key: string | null = null,
)}
  <button
    title={shortcuts.tooltip(title, key)}
    aria-label={title}
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onclick={act}
  >
    {#if glyph}
      <CanvasIcon node={glyph} />
    {:else if low}
      <span class="low">{label}</span>
    {:else}
      {label}
    {/if}
  </button>
{/snippet}

{#snippet dot(colour: HighlightColour, on: boolean, act: () => void)}
  <button
    class="swatch"
    class:on
    class:bare={colour.tone === null}
    title={t(colour.name)}
    aria-label={t(colour.name)}
    aria-pressed={on}
    style:--dot={dotFor(colour.tone)}
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onclick={act}
  ></button>
{/snippet}

{#snippet buttons()}
  {#if colouring}
    {#each HIGHLIGHT_COLOURS as colour (colour.name)}
      {@render dot(colour, colour.tone === modes.highlight.tone, () => pick(colour))}
    {/each}
    {@render press(t('Highlight colour'), '×', () => void showColours(false))}
  {:else}
    {#each held as id (id)}
      {@render press(nameFor(id), markFor(id), () => act(id), glyphFor(id), lowMark(id), id)}

      {#if id === HIGHLIGHT}
        {@render dot(modes.highlight, false, () => void showColours(true))}
      {/if}
    {/each}
  {/if}
{/snippet}

{#if docked}
  <div
    class="orden-bar docked"
    role="toolbar"
    aria-label={t('Format')}
    bind:this={bar}
    bind:offsetHeight={viewport.covered}
    use:roving={keys}
    style:bottom="{viewport.keyboard}px"
  >
    {@render buttons()}
  </div>
{:else if at}
  <div
    class="orden-bar orden-bar-at"
    role="toolbar"
    aria-label={t('Format')}
    bind:this={bar}
    use:roving={keys}
    style:left="{at.x}px"
    style:top="{at.y}px"
  >
    {@render buttons()}
  </div>
{/if}

<style>
  .docked {
    position: fixed;
    z-index: var(--z-bar);
    left: 0;
    right: 0;
    justify-content: space-around;
    gap: 0;
    padding: 4px max(4px, var(--inset-left)) 4px max(4px, var(--inset-right));
    border-radius: 0;
    border-width: 1px 0 0;
  }

  .docked button {
    flex: 1;
    min-width: 0;
    height: 44px;
    font-size: var(--text-base);
  }

  button :global(svg) {
    --mark: 1.2em;

    display: block;
    margin: 0 auto;
  }

  .low {
    display: inline-block;
    transform: translateY(0.2em);
  }

  .swatch {
    display: grid;
    place-items: center;
  }

  .swatch::after {
    content: '';
    display: block;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:hover::after {
    scale: 1.14;
  }

  .swatch:active::after {
    scale: 1.04;
  }

  .swatch.on::after {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent),
      0 0 0 2px var(--surface-3),
      0 0 0 3px var(--accent);
  }

  .swatch.bare::after {
    background: none;
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  .swatch.bare.on::after {
    box-shadow:
      inset 0 0 0 2px var(--muted),
      0 0 0 2px var(--surface-3),
      0 0 0 3px var(--accent);
  }

  .swatch:hover,
  .swatch:active {
    background: none;
  }

  :global([data-touch]) .swatch::after {
    width: 20px;
    height: 20px;
  }
</style>
