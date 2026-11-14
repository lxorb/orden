<script module lang="ts">
  import { owes, writing } from '../../parting'

  let owing: (() => void) | null = null
  owes(() => owing?.())

  let caret: number | null = null
</script>

<script lang="ts">
  import { createEditor, EditorView, setNoteIndex } from '@orden/editor'
  import { onMount } from 'svelte'
  import { SAVE_DELAY } from '../../platform/src/api'
  import { pickedLink } from '../../composer'
  import { adrift, pressedThrough } from '../../keyboard-home'
  import { links } from '../../link-index.svelte'
  import { modes } from '../../modes.svelte'
  import { followHref, followNoteFrom } from '../../open-link'
  import { shortcuts } from '../../shortcuts.svelte'
  import { afterQuiet } from '../../platform/src/api'
  import { scratchpad } from './pad'
  import { closeScratchpad, padTab, shown, WIDTH } from './is.svelte'
  import { viewport } from '../../ui-kit/src/api'

  const { docked = false }: { docked?: boolean } = $props()

  const NARROWEST = 240
  const WIDEST = 560
  const fit = (width: number) => Math.round(Math.min(WIDEST, Math.max(NARROWEST, width)))

  let host: HTMLDivElement
  let view = $state<EditorView | null>(null)
  let path: string | null = null
  let owed = false
  let resizing = $state(false)

  function flush() {
    save.cancel()
    if (!owed || path === null || !view) return
    owed = false
    writing(scratchpad.writeDown(path, view.state.doc.toString()))
  }
  const save = afterQuiet(flush, SAVE_DELAY)

  onMount(() => {
    const going = new AbortController()
    void (async () => {
      const at = await scratchpad.where()
      path = at
      const text = await scratchpad.editable().catch(() => null)
      if (going.signal.aborted) return
      if (text === null) {
        path = null
        shown.hide()
        void import('../../unread.svelte').then((one) => one.unread.there(at))
        return
      }

      const made = createEditor({
        parent: host,
        doc: text,
        selection: { anchor: Math.min(caret ?? text.length, text.length) },
        onChange: () => {
          owed = true
          save()
        },
        notes: links.index(path),
        openNote: followNoteFrom(path),
        openLink: followHref,
        writeLink: pickedLink,
        shortcuts: shortcuts.forEditor,
        trustedMarkup: false,
      })
      modes.apply(made)
      view = made
      shown.view = made
      scratchpad.live = made
      owing = flush
    })()

    return () => {
      going.abort()
      flush()
      owing = null
      scratchpad.live = null
      if (shown.view === view) shown.view = null
      caret = view?.state.selection.main.head ?? caret
      if (view) modes.forget(view)
      view?.destroy()
    }
  })

  $effect(() => {
    const index = links.index(path)
    if (view) setNoteIndex(view, index)
  })

  $effect(() => {
    if (padTab()) closeScratchpad()
  })

  $effect(() => {
    if (!shown.calling || !view) return
    shown.calling = false

    const at = document.activeElement
    if (at instanceof HTMLElement && !host.contains(at) && !adrift(at) && !pressedThrough(at)) {
      shown.from = at
    }
    view.focus()

    const line = scratchpad.line
    scratchpad.line = null
    if (line === null) return
    const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    })
  })

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    closeScratchpad()
  }

  function grab(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const edge = event.currentTarget as HTMLElement
    edge.setPointerCapture(event.pointerId)
    const from = event.clientX
    const was = shown.width
    resizing = true
    const move = (one: PointerEvent) => shown.resize(fit(was - (one.clientX - from)))
    const done = () => {
      resizing = false
      edge.removeEventListener('pointermove', move)
    }
    edge.addEventListener('pointermove', move)
    edge.addEventListener('lostpointercapture', done, { once: true })
  }

  function onEdgeKey(event: KeyboardEvent) {
    const step = { ArrowLeft: 16, ArrowRight: -16 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    shown.resize(fit(shown.width + step))
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="card" class:resizing class:docked data-scratchpad-card data-covers onkeydown={onKey}>
  {#if !viewport.touch && !docked}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuemin={NARROWEST}
      aria-valuemax={WIDEST}
      aria-valuenow={shown.width}
      tabindex="0"
      title="Drag to resize"
      onpointerdown={grab}
      ondblclick={() => shown.resize(WIDTH)}
      onkeydown={onEdgeKey}
    ></div>
  {/if}
  <div class="host" bind:this={host}></div>
</div>

<style>
  :global([data-scratchpad]) {
    max-width: 60%;
  }

  :global(:is([data-drawer], [data-narrow]) [data-scratchpad]) {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: var(--z-lifted);
    max-width: 100%;
  }

  :global(html:not([data-device='desktop']) [data-scratchpad]) {
    position: absolute;
    inset: 0;
    z-index: var(--z-lifted);
    max-width: none;
  }

  :global(html:not([data-device='desktop']) [data-scratchpad]) .card {
    width: 100%;
    margin: 0;
    border: none;
    border-radius: 0;
  }

  :global([data-scratchpad]:is(.moving, .coming)) .card {
    min-width: calc(var(--pad-width) - 2 * var(--space-2));
  }

  .card {
    position: relative;
    flex: none;
    width: calc(100% - 2 * var(--space-2));
    margin: var(--space-2);
    display: flex;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--card-edge);
    border-radius: var(--card-radius);
    background: var(--bg);
  }

  .card.docked {
    width: 100%;
    height: 100%;
    margin: 0;
  }

  .host {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .host :global(.cm-editor) {
    flex: 1;
    min-width: 0;
    background: none;
  }

  :global(html[data-device='desktop']) .host :global(#write) {
    max-width: none;
    margin: 0 var(--space-4);
    padding: var(--space-4) 0 var(--space-7);
  }

  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    inset-inline-start: 0;
    width: 6px;
    z-index: var(--z-lifted);
    cursor: col-resize;
  }

  .edge::after {
    content: '';
    position: absolute;
    top: var(--radius-md);
    bottom: var(--radius-md);
    inset-inline-start: 0;
    width: 2px;
    background: transparent;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .edge:hover::after,
  .resizing .edge::after {
    background: var(--accent);
  }
</style>
