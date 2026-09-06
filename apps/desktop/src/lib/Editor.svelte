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
    replaceDoc,
    setNoteIndex,
    type Text,
  } from '@nib/editor'
  import { shortcuts } from './shortcuts.svelte'

  /* eslint-disable prefer-const -- `view` is bindable, and a $props() pattern cannot be split */
  let {
    doc = '',
    pushed = 0,
    onchange,
    onimage,
    resolveimage,
    openlink,
    onselection,
    notes,
    opennote,
    nameblock,
    view = $bindable(),
  }: {
    doc?: string
    /** Counts the times `doc` was replaced from outside the editor. Typing
     *  never changes it, and it is the only thing this component watches:
     *  comparing the text instead would mean reading the whole note back on
     *  every keystroke, which is what a large note could not afford. */
    pushed?: number
    onchange?: (doc: Text) => void
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

  // Built once. Reading `doc` reactively here would tear the editor down and
  // rebuild it on every keystroke, losing the caret each time.
  $effect(() => {
    const created = createEditor({
      parent: host,
      doc: untrack(() => doc),
      // Each handed over only when there is one. The editor has defaults of its
      // own for several of these - `openLink` opens a browser tab - and passing
      // undefined would take the default away rather than leave it in place.
      ...(onchange ? { onChange: onchange } : {}),
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

  /** Which push the view has taken. Starts at whatever it was built with, so
   *  a view made for a note that had already been pushed to does not replace
   *  its own text on the way up. */
  let taken = untrack(() => pushed)

  // Pushes externally loaded content in without recreating the view.
  $effect(() => {
    const at = pushed
    if (!view || at === taken) return

    taken = at
    replaceDoc(
      view,
      untrack(() => doc),
    )
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
