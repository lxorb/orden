<script lang="ts" module>
  /** The writing surface rises into place when the app opens. Once only: the
   *  editor is rebuilt for every tab, and replaying the entrance on each
   *  switch reads as a flicker rather than as a note arriving. */
  let opened = false
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { createEditor, type EditorView, replaceDoc, type Text } from '@nib/editor'

  let {
    doc = '',
    pushed = 0,
    onchange,
    onimage,
    resolveimage,
    openlink,
    onselection,
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
    view?: EditorView
  } = $props()

  let host: HTMLDivElement
  const rise = !opened
  opened = true

  // Built once. Reading `doc` reactively here would tear the editor down and
  // rebuild it on every keystroke, losing the caret each time.
  $effect(() => {
    const created = createEditor({
      parent: host,
      doc: untrack(() => doc),
      onChange: onchange,
      onImage: onimage,
      resolveImage: resolveimage,
      openLink: openlink,
      onSelection: onselection,
    })
    view = created
    if (import.meta.env.DEV) Object.assign(window, { nib: created })

    return () => {
      created.destroy()
      view = undefined
    }
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
    replaceDoc(view, untrack(() => doc))
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
