<script lang="ts">
  import { untrack } from 'svelte'
  import { createEditor, type EditorView } from '@nib/editor'

  let {
    doc = '',
    onchange,
    onimage,
    resolveimage,
    openlink,
    onselection,
    view = $bindable(),
  }: {
    doc?: string
    onchange?: (value: string) => void
    onimage?: (file: File) => Promise<string | null>
    resolveimage?: (src: string) => string
    openlink?: (href: string) => void
    onselection?: (view: EditorView) => void
    view?: EditorView
  } = $props()

  let host: HTMLDivElement

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

  // Pushes externally loaded content in without recreating the view.
  $effect(() => {
    const incoming = doc
    if (!view) return

    const current = view.state.doc.toString()
    if (incoming === current) return

    view.dispatch({ changes: { from: 0, to: current.length, insert: incoming } })
  })
</script>

<div class="surface" bind:this={host}></div>

<style>
  .surface {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    animation: rise var(--dur-slow) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }
</style>
