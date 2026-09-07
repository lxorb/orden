<script lang="ts" module>
  /** The writing surface rises into place when the app opens. Once only: the
   *  pane's editor outlives every note it shows, so replaying the entrance would
   *  mean the second pane arriving as if the app had just started. */
  let opened = false

  /** True the first time it is asked, and false ever after. */
  function firstOfTheSession(): boolean {
    const first = !opened
    opened = true
    return first
  }
</script>

<script lang="ts">
  /** One pane's editor: the view, and the note that is in it.
   *
   *  The view is built once and kept. Every note the pane shows is a state
   *  swapped into it - the caret, the scroll and the modes all in the frame the
   *  switch happens in - rather than an editor built and thrown away per tab.
   *  See editor-states.ts, and held.ts in the editor package. */

  import { untrack } from 'svelte'
  import {
    createEditor,
    editorState,
    EditorView,
    HeldState,
    modeEffects,
    type NoteIndex,
    type NoteJump,
    noteIndexEffect,
    setNoteIndex,
    type StateEffect,
    type StateOptions,
    shortcutEffect,
  } from '@nib/editor'
  import { EditorStates } from './editor-states'
  import { modes } from './modes.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import type { Tab } from './workspace.svelte'

  /* eslint-disable prefer-const -- `view` is bindable, and a $props() pattern cannot be split */
  let {
    tab,
    kept,
    onimage,
    resolveimage,
    openlink,
    onselection,
    notes,
    opennote,
    nameblock,
    view = $bindable(),
  }: {
    /** The note showing in this pane. Anything that depends on which note it is
     *  is asked of the tab rather than captured once, because the pane's editor
     *  outlives the note in it. */
    tab: Tab
    /** Which tabs the pane still holds. A note it no longer holds lets its
     *  document go; see `keepOnly`. */
    kept: string[]
    onimage?: (file: File, tab: Tab) => Promise<string | null>
    resolveimage?: (src: string, tab: Tab) => string
    openlink?: (href: string) => void
    onselection?: (view: EditorView) => void
    /** The space around a note, so `[[links]]` can be drawn and completed. */
    notes?: (tab: Tab) => NoteIndex
    opennote?: (jump: NoteJump) => void
    nameblock?: (path: string, line: number) => Promise<string | null>
    /** Bound back out: undefined until the view has been made. */
    view?: EditorView | undefined
  } = $props()
  /* eslint-enable prefer-const */

  let host: HTMLDivElement
  const rise = firstOfTheSession()
  const states = new EditorStates()
  /** The index the view has been given. A fresh object means the space changed,
   *  which is what makes every link on screen be drawn again; the same one means
   *  nothing did, and reconfiguring for it would redraw the note for nothing. */
  let held: NoteIndex | undefined

  /** Everything a state needs to be this note's state, all of it read from the
   *  tab so a state built for one note says nothing about another. */
  function optionsFor(one: Tab): StateOptions {
    return {
      shared: one.note.live,
      // The caret belongs in the state: put in afterwards it is a frame the note
      // spends at its own top.
      selection: { anchor: one.cursor ?? 0 },
      // Each handed over only when there is one. The editor has defaults of its
      // own for several of these - `openLink` opens a browser tab - and passing
      // undefined would take the default away rather than leave it in place.
      ...(onimage ? { onImage: (file: File) => onimage(file, one) } : {}),
      ...(resolveimage ? { resolveImage: (src: string) => resolveimage(src, one) } : {}),
      ...(openlink ? { openLink: openlink } : {}),
      ...(onselection ? { onSelection: onselection } : {}),
      ...(notes ? { notes: notes(one) } : {}),
      ...(opennote ? { openNote: opennote } : {}),
      ...(nameblock ? { nameBlock: nameblock } : {}),
      // The keys the reader chose, so the first keystroke in a note that has
      // just opened is already theirs.
      shortcuts: shortcuts.forEditor,
    }
  }

  /** Where the note was last being read, as the effect that puts it back. A
   *  position rather than a pixel count: line heights are estimates until they
   *  are measured and change with the width of the window, so the same offset
   *  lands on a different line from one opening to the next. */
  function placeOf(one: Tab): StateEffect<unknown> | null {
    return one.anchor === undefined ? null : EditorView.scrollIntoView(one.anchor, { y: 'start' })
  }

  /** The modes and the keys as one string, which changes whenever any of them
   *  does. Read off what the app holds rather than counted, so a mode nobody
   *  thought to count cannot go missing. */
  function dressing(): string {
    return JSON.stringify([modes.settings, shortcuts.forEditor])
  }

  /** What the app has to say about a note that is not already in its state, in
   *  the transaction that shows the note - so the note appears already dressed
   *  rather than settling over the frames after it.
   *
   *  The space's links go on every time, because the index is a new object
   *  whenever anything in the space changed and putting one in is a field update.
   *  The modes and the keys go on only when they are not what the state was built
   *  or last shown for: each of those is a reconfiguration, and reconfiguring
   *  throws away the parse and every decoration on screen. */
  function fitting(one: Tab, index: NoteIndex | undefined): StateEffect<unknown>[] {
    const stamp = dressing()
    const dressed = states.fitted(one.id) === stamp
    states.fit(one.id, stamp)

    return [
      ...(index ? [noteIndexEffect(index)] : []),
      ...(dressed ? [] : modeEffects(modes.settings)),
      ...(dressed ? [] : [shortcutEffect(shortcuts.forEditor)]),
    ]
  }

  // Built once, on the note the pane opens with. Reading anything reactively
  // here would tear the editor down and rebuild it, losing the caret each time.
  $effect(() => {
    const first = untrack(() => tab)
    const created = createEditor({ parent: host, ...untrack(() => optionsFor(first)) })

    states.started(
      first.id,
      first.note.live,
      created,
      untrack(() => placeOf(first)),
    )
    view = created
    if (import.meta.env.DEV) Object.assign(window, { nib: created })

    return () => {
      // Every document the pane was holding lets go first: one that carried its
      // changes into a state or a view that no longer exists would be carrying
      // them nowhere.
      states.releaseAll(created)
      created.destroy()
      view = undefined
      held = undefined
    }
  })

  // The note. Swapped in whole, in the same frame as the click that asked for
  // it: see editor-states.ts.
  $effect(() => {
    const current = view
    const showing = tab
    if (!current) return

    const index = notes?.(showing)
    held = index
    states.show(current, showing.id, () => build(showing), fitting(showing, index))

    // A session written by a build that remembered pixels rather than a line has
    // no line to put back. The offset is the best it can do, and it goes on here
    // rather than a frame later.
    if (showing.anchor === undefined && showing.scroll) {
      current.scrollDOM.scrollTop = showing.scroll
    }
  })

  function build(one: Tab): HeldState {
    return HeldState.waiting(one.note.live, editorState(optionsFor(one)), placeOf(one))
  }

  // The space changes while the pane sits on one note: a note saved gains a
  // heading, a note renamed answers to another name. Handed over on its own, so
  // nothing else about the note is disturbed.
  $effect(() => {
    const current = view
    const index = notes?.(tab)
    if (!current || !index || index === held) return

    held = index
    setNoteIndex(current, index)
  })

  // Notes the pane no longer holds - closed, or dragged into another pane - let
  // their documents go.
  $effect(() => {
    states.keepOnly(kept)
  })
</script>

<div class="surface" class:rise bind:this={host}></div>

<style>
  .surface {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .rise {
    animation: rise var(--dur-slow) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }
</style>
