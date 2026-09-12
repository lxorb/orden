<script lang="ts">
  import {
    clearFormatting,
    insertLink,
    selectedImage,
    setHeading,
    toggleQuote,
    toggleWrap,
    type EditorView,
    type StateCommand,
    type Transaction,
  } from '@nib/editor'
  import { t } from './i18n.svelte'
  import { roving } from './roving'
  import { viewport } from './viewport.svelte'

  const { view }: { view?: EditorView | undefined } = $props()

  let at = $state<{ x: number; y: number } | null>(null)
  let bar = $state<HTMLElement>()

  /** One tab stop with the arrows inside it, which is what every strip in the app
   *  is; see roving.ts and docs/keyboard.md. Enter and Space press the button the
   *  arrows are on, and Escape gives the note the keyboard back. */
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
    { label: 'M', title: t('Highlight'), command: toggleWrap('==') },
    { label: '<>', title: t('Code'), command: toggleWrap('`') },
    { label: 'H', title: t('Heading'), command: setHeading(2) },
    { label: '"', title: t('Quote'), command: toggleQuote },
    { label: '#', title: t('Link'), command: insertLink },
    { label: '×', title: t('Clear formatting'), command: clearFormatting },
  ]
</script>

<!-- A row of buttons that acts on what is selected, which is what a toolbar is,
     and it says so: the words on the buttons are one letter each, so the name of
     the row is the only thing that says what the row is for.

     Every action runs on the click and not on the press. A press is how a pointer
     arrives and a click is how a pointer and a key both do, and reading the press
     meant the whole bar was a row of buttons that answered a finger, a mouse and
     nothing else: Enter on one of them focused it and did not format a word. The
     press is still read, for the one thing it is for - keeping the caret, and on a
     phone the keyboard, where they are. -->
{#if docked}
  <div
    class="nib-bar docked"
    role="toolbar"
    aria-label={t('Format')}
    bind:this={bar}
    use:roving={keys}
    style:bottom="{viewport.keyboard}px"
  >
    {#each ACTIONS as action (action.title)}
      <button
        title={action.title}
        aria-label={action.title}
        onpointerdown={(event) => event.preventDefault()}
        onclick={() => run(action.command)}
      >
        {action.label}
      </button>
    {/each}
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
    {#each ACTIONS as action (action.title)}
      <button
        title={action.title}
        aria-label={action.title}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => run(action.command)}
      >
        {action.label}
      </button>
    {/each}
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
</style>
