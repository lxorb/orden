<script lang="ts">
  import {
    clearFormatting,
    highlightSelection,
    insertLink,
    selectedImage,
    setHeading,
    toggleHighlight,
    toggleQuote,
    toggleWrap,
    type EditorView,
    type StateCommand,
    type Transaction,
  } from '@nib/editor'
  import { HIGHLIGHT_COLOURS } from '@nib/markdown/highlights'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { roving } from './roving'
  import { viewport } from './viewport.svelte'

  const { view }: { view?: EditorView | undefined } = $props()

  let at = $state<{ x: number; y: number } | null>(null)
  let bar = $state<HTMLElement>()
  /** Whether the colours are showing instead of the actions. */
  let colouring = $state(false)

  /** One tab stop with the arrows inside it, which is what every strip in the app
   *  is; see roving.ts and docs/keyboard.md. Enter and Space press the button the
   *  arrows are on, and Escape gives the note the keyboard back. The colours are
   *  buttons in that same row, so each is a stop of its own and the arrows reach
   *  them without a second rule. */
  const keys = { across: true, rows: 'button' } as const

  /** Docked above the keyboard on a phone: there is no hovering over a
   *  selection with a thumb, and the buttons are wanted before the selection
   *  exists rather than after it. */
  const docked = $derived(viewport.touch && viewport.typing)

  /** Follows the selection, and hides the moment there is nothing selected.
   *  A selected picture has a toolbar of its own, in the same place, and a
   *  note being read has nothing to format: every button here writes. */
  export function follow(current: EditorView) {
    const range = current.state.selection.main

    // The bar goes when the note stops being written in - but not while the bar
    // itself has the keyboard, or reaching a button with a key would take the bar
    // away from under it and leave the focus on nothing at all.
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

    const start = current.coordsAtPos(range.from)
    const end = current.coordsAtPos(range.to)
    if (!start || !end) {
      at = null
      return
    }

    // Kept clear of both edges: the bar is centred on the selection, but a
    // selection near the margin would otherwise push it off screen.
    const half = 150
    const middle = (start.left + end.right) / 2
    const x = Math.min(Math.max(middle, half), window.innerWidth - half)

    at = { x, y: Math.min(start.top, end.top) }
  }

  function run(command: StateCommand) {
    if (!view) return
    command({ state: view.state, dispatch: (t: Transaction) => view.dispatch(t) })
    view.focus()
  }

  const ACTIONS: { label: string; title: string; command: StateCommand }[] = [
    { label: 'B', title: t('Bold'), command: toggleWrap('**') },
    { label: 'I', title: t('Italic'), command: toggleWrap('*') },
    { label: 'S', title: t('Strikethrough'), command: toggleWrap('~~') },
    { label: 'M', title: t('Highlight'), command: highlightSelection },
    { label: '<>', title: t('Code'), command: toggleWrap('`') },
    { label: 'H', title: t('Heading'), command: setHeading(2) },
    { label: '"', title: t('Quote'), command: toggleQuote },
    { label: '#', title: t('Link'), command: insertLink },
    { label: '×', title: t('Clear formatting'), command: clearFormatting },
  ]

  /** What the swatch beside the highlight button is drawn in: the colour that
   *  button writes, so the bar says what it is about to do. A highlight with no
   *  colour of its own wears the accent, which is what it is drawn in. */
  const swatch = $derived(
    modes.highlight.tone === null ? 'var(--accent-soft)' : `var(--mark-${modes.highlight.tone})`,
  )

  /** Highlights the selection in this colour, and keeps it: the button, the
   *  shortcut and the menu row all write it from now on. */
  function pick(tone: number | null) {
    const colour = HIGHLIGHT_COLOURS.find((one) => one.tone === tone)
    if (!colour) return

    modes.setHighlightTone(tone)
    colouring = false
    run(toggleHighlight(colour))
  }
</script>

<!-- A row of buttons that acts on what is selected, which is what a toolbar is,
     and it says so: the words on the buttons are one letter each, so the name of
     the row is the only thing that says what the row is for.

     Every action runs on the click and not on the press. A press is how a pointer
     arrives and a click is how a pointer and a key both do, and reading the press
     meant the whole bar was a row of buttons that answered a finger, a mouse and
     nothing else: Enter on one of them focused it and did not format a word. The
     press is still read, for the one thing it is for - keeping the caret, and on a
     phone the keyboard, where they are. Both handlers, because the two bars arrive
     by different events and one list of buttons serves both.

     One list of buttons for both bars, because they are the same bar in two
     places: a strip over the keyboard on a phone, a callout by the selection
     everywhere else. -->
{#snippet press(title: string, label: string, act: () => void, on = false, dot?: string)}
  <button
    class:swatch={dot !== undefined}
    class:on
    {title}
    aria-label={title}
    aria-pressed={on}
    style:--dot={dot}
    onpointerdown={(event) => event.preventDefault()}
    onmousedown={(event) => event.preventDefault()}
    onclick={act}
  >
    {label}
  </button>
{/snippet}

{#snippet buttons()}
  <!-- The colours, in the bar rather than over it: a phone's bar is the width of
       the screen and has nowhere to put a second surface, and one row is the same
       bar on both. The swatch stays where it was, so pressing it again comes
       back. -->
  {@render press(t('Highlight colour'), '', () => (colouring = !colouring), colouring, swatch)}

  {#if colouring}
    {#each HIGHLIGHT_COLOURS as colour (colour.name)}
      {@render press(
        t(colour.name),
        '',
        () => pick(colour.tone),
        colour.tone === modes.highlight.tone,
        colour.tone === null ? 'var(--accent-soft)' : `var(--mark-${colour.tone})`,
      )}
    {/each}
  {:else}
    {#each ACTIONS as action (action.title)}
      {@render press(action.title, action.label, () => run(action.command))}
    {/each}
  {/if}
{/snippet}

{#if docked}
  <div
    class="nib-bar docked"
    role="toolbar"
    aria-label={t('Format')}
    bind:this={bar}
    use:roving={keys}
    style:bottom="{viewport.keyboard}px"
  >
    {@render buttons()}
  </div>
{:else if at}
  <div
    class="nib-bar nib-bar-at"
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
  /* The bar's own shape is `.nib-bar` in the theme, which the two bars that
     float over a surface share; see base.css. Only what is different about a
     bar docked over the keyboard is here.

     A strip across the bottom, sitting on the keyboard. Full width so every
     button is a thumb's width, and positioned by `bottom` rather than by a
     transform. */
  .docked {
    position: fixed;
    z-index: 25;
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

  /* A colour, as the dot the whole app asks "which colour" with; the row of them
     on the canvas is the same shape - see CanvasColours.svelte. The hairline is
     the page's own ink at a whisper rather than black at a whisper, so a pale
     wash on a pale bar still has an edge in both themes. */
  .swatch {
    display: grid;
    place-items: center;
  }

  .swatch::after {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:hover::after,
  .swatch.on::after {
    scale: 1.12;
  }

  /* The chosen colour, and the swatch while its row is open: the ring the rest of
     the app draws round a choice. */
  .swatch.on::after {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent),
      0 0 0 2px var(--surface-3),
      0 0 0 4px var(--accent);
  }

  /* The bar tints a button on hover, which would swallow a dot's own colour. */
  .swatch:hover,
  .swatch:active {
    background: none;
  }

  :global([data-touch]) .swatch::after {
    width: 20px;
    height: 20px;
  }
</style>
