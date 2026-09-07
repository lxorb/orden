<script lang="ts" module>
  /** The writing surface rises into place when the app opens. Once only: the
   *  editor is rebuilt for every tab, and replaying the entrance on each
   *  switch reads as a flicker rather than as a note arriving. */
  let opened = false

  /** True the first time it is asked, and false ever after. */
  function firstOfTheSession(): boolean {
    const first = !opened
    opened = true
    return first
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import {
    createEditor,
    type EditorView,
    type NoteIndex,
    type NoteJump,
    setNoteIndex,
    type SharedDoc,
  } from '@nib/editor'
  import { shortcuts } from './shortcuts.svelte'

  /* eslint-disable prefer-const -- `view` is bindable, and a $props() pattern cannot be split */
  let {
    shared,
    onimage,
    resolveimage,
    openlink,
    onselection,
    notes,
    opennote,
    nameblock,
    view = $bindable(),
  }: {
    /** The document this view is a window onto: its text, its undo history, and
     *  the other panes showing the same note. A note keeps one document for as
     *  long as it is open, so this never changes under a view - the one tab that
     *  previews notes keeps its document and the document takes the new note on.
     *  See shared.ts in the editor package. */
    shared: SharedDoc
    onimage?: (file: File) => Promise<string | null>
    resolveimage?: (src: string) => string
    openlink?: (href: string) => void
    onselection?: (view: EditorView) => void
    /** The space around this note, so `[[links]]` can be drawn and completed.
     *  Handed over again whenever it changes; see `setNoteIndex`. */
    notes?: NoteIndex
    opennote?: (jump: NoteJump) => void
    nameblock?: (path: string, line: number) => Promise<string | null>
    /** Bound back out: undefined until the view has been made. */
    view?: EditorView | undefined
  } = $props()
  /* eslint-enable prefer-const */

  let host: HTMLDivElement
  const rise = firstOfTheSession()

  // Built once, on the document it was handed. Reading anything reactively here
  // would tear the editor down and rebuild it, losing the caret each time.
  $effect(() => {
    const document = untrack(() => shared)
    const created = createEditor({
      parent: host,
      shared: document,
      // Each handed over only when there is one. The editor has defaults of its
      // own for several of these - `openLink` opens a browser tab - and passing
      // undefined would take the default away rather than leave it in place.
      ...(onimage ? { onImage: onimage } : {}),
      ...(resolveimage ? { resolveImage: resolveimage } : {}),
      ...(openlink ? { openLink: openlink } : {}),
      ...(onselection ? { onSelection: onselection } : {}),
      ...(notes ? { notes: untrack(() => notes) } : {}),
      ...(opennote ? { openNote: opennote } : {}),
      ...(nameblock ? { nameBlock: nameblock } : {}),
      // The keys the reader chose, so the first keystroke in a note that has
      // just opened is already theirs.
      shortcuts: shortcuts.forEditor,
    })
    view = created
    if (import.meta.env.DEV) Object.assign(window, { nib: created })

    return () => {
      // The document lets the view go first: it carries every change into the
      // views it holds, and one that has been destroyed is not one of them.
      document.leave(created)
      created.destroy()
      view = undefined
    }
  })

  /** The index the view has been given. A fresh object means the space changed,
   *  which is what makes every link on screen be drawn again; the same one means
   *  nothing did, and reconfiguring for it would redraw the note for nothing. */
  let held = untrack(() => notes)

  $effect(() => {
    const index = notes
    if (!view || !index || index === held) return

    held = index
    setNoteIndex(view, index)
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
