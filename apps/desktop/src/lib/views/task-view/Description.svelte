<script lang="ts">
  import { createEditor, type EditorView, modeEffects } from '@orden/editor'
  import { onMount } from 'svelte'
  import { pickedLink } from '../../composer'
  import { t } from '../../i18n.svelte'
  import { links } from '../../link-index.svelte'
  import { modes } from '../../modes.svelte'
  import { followHref, followNoteFrom } from '../../open-link'
  import { shortcuts } from '../../shortcuts.svelte'
  import { afterQuiet } from '../../timing'
  import { workspace } from '../../workspace.svelte'
  import { noteText } from '../../workspace/note-text'
  import { describe } from '../act'
  import { descriptionOf } from '../task-body'

  const {
    path,
    anchor,
    writable = true,
  }: {
    path: string
    anchor: () => { line: number; hash: string } | null
    writable?: boolean
  } = $props()

  let host = $state<HTMLDivElement>()
  let view: EditorView | null = null
  let empty = $state(true)
  let focused = $state(false)
  let owed = false

  function flush() {
    save.cancel()
    const at = anchor()
    if (!view || !at || !writable || !owed) return
    owed = false
    void describe(path, at, view.state.doc.toString())
  }
  const save = afterQuiet(flush, 400)

  onMount(() => {
    const going = new AbortController()
    void (async () => {
      const text = await noteText(workspace, path)
      const at = anchor()
      if (going.signal.aborted || text === null || !at || !host) return
      const words = descriptionOf(text, at)?.text ?? ''
      empty = words.trim() === ''
      const made = createEditor({
        parent: host,
        doc: words,
        onChange: (doc) => {
          empty = doc.length === 0
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
      const settings = writable
        ? modes.settings
        : { ...modes.settings, readOnly: true, source: false }
      made.dispatch({ effects: modeEffects(settings) })
      view = made
    })()
    return () => {
      going.abort()
      flush()
      view?.destroy()
      view = null
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="description"
  onfocusin={() => (focused = true)}
  onfocusout={() => {
    focused = false
    flush()
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') view?.contentDOM.blur()
  }}
>
  <div class="host" bind:this={host}></div>
  {#if empty && !focused}
    <span class="placeholder" aria-hidden="true">{t('Description')}</span>
  {/if}
</div>

<style>
  .description {
    --text-content: var(--text-row);
    position: relative;
    min-height: 1.6em;
  }

  .host :global(.cm-editor) {
    min-height: 0;
    background: none;
  }

  .host :global(.cm-scroller) {
    min-height: 0;
    overflow: visible;
  }

  .host :global(:is(#write, .nib-write)) {
    max-width: none;
    min-height: 0;
    margin: 0;
    padding: 0;
  }

  .placeholder {
    position: absolute;
    inset: 0 auto auto 0;
    color: var(--muted);
    font-size: var(--text-row);
    pointer-events: none;
  }
</style>
