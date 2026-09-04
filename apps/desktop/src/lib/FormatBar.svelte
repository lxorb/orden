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
  import { KEYBOARD_THRESHOLD, viewport } from './viewport.svelte'

  let { view }: { view?: EditorView } = $props()

  let at = $state<{ x: number; y: number } | null>(null)

  /** Docked above the keyboard on a phone: there is no hovering over a
   *  selection with a thumb, and the buttons are wanted before the selection
   *  exists rather than after it. */
  const docked = $derived(viewport.phone && viewport.keyboard > KEYBOARD_THRESHOLD)

  /** Follows the selection, and hides the moment there is nothing selected.
   *  A selected picture has a toolbar of its own, in the same place. */
  export function follow(current: EditorView) {
    const range = current.state.selection.main

    if (range.empty || !current.hasFocus || selectedImage(current.state)) {
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
    command({ state: view.state, dispatch: (t: Transaction) => view!.dispatch(t) })
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

{#if docked}
  <div class="bar docked" style:bottom="{viewport.keyboard}px">
    {#each ACTIONS as action (action.title)}
      <button
        title={action.title}
        aria-label={action.title}
        onpointerdown={(event) => {
          // The editor must keep focus, or the keyboard closes under the bar.
          event.preventDefault()
          run(action.command)
        }}
      >
        {action.label}
      </button>
    {/each}
  </div>
{:else if at}
  <div class="bar" style:left="{at.x}px" style:top="{at.y}px">
    {#each ACTIONS as action (action.title)}
      <button
        title={action.title}
        aria-label={action.title}
        onmousedown={(event) => {
          event.preventDefault()
          run(action.command)
        }}
      >
        {action.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  /* Above the selection, centred on it, and out of the way of the caret. */
  .bar {
    position: fixed;
    z-index: 25;
    transform: translate(-50%, calc(-100% - 10px));
    display: flex;
    gap: 1px;
    padding: 3px;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    animation: bar-in var(--dur-fast) var(--ease-out);
  }

  /* A strip across the bottom, sitting on top of the keyboard. Full width so
     every button is a thumb's width, and no transform: `bottom` is doing the
     positioning here. */
  .bar.docked {
    left: 0;
    right: 0;
    transform: none;
    justify-content: space-around;
    gap: 0;
    padding: 4px max(4px, env(safe-area-inset-left)) 4px max(4px, env(safe-area-inset-right));
    border-radius: 0;
    border-width: 1px 0 0;
    animation: none;
  }

  .bar.docked button {
    flex: 1;
    min-width: 0;
    height: 44px;
    font-size: var(--text-base);
  }

  @keyframes bar-in {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-100% - 4px));
    }
  }

  button {
    min-width: 26px;
    height: 24px;
    padding: 0 5px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:hover {
    background: var(--accent);
    color: #fff;
  }
</style>
