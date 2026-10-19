<script lang="ts">
  /** A task's description, edited the way a note is: nib's own editor, live preview and
   *  all, over the prose written under the task (task-body.ts). What is typed is written
   *  back into the note a moment after the typing stops, as one edit, indented to be the
   *  task's own; the note's other words are never touched.
   *
   *  Read once as it opens and never again while it is up: the words in it are the
   *  reader's own, and a write coming back from the note would only move the caret. */
  import { createEditor, type EditorView, modeEffects } from '@nib/editor'
  import { onMount } from 'svelte'
  import { pickedLink } from '../../composer'
  import { t } from '../../i18n.svelte'
  import { links } from '../../link-index.svelte'
  import { modes } from '../../modes.svelte'
  import { followHref, followNote } from '../../open-link'
  import { PROPERTY_CHOICES } from '../../property-choices'
  import { shortcuts } from '../../shortcuts.svelte'
  import { afterQuiet } from '../../timing'
  import { workspace } from '../../workspace.svelte'
  import { noteText } from '../../workspace/note-text'
  import { describe } from '../act'
  import { descriptionOf } from '../task-body'

  const {
    path,
    anchor,
  }: {
    /** The note, on this disk. */
    path: string
    /** Where the task is now, asked at every write: its words may have changed. */
    anchor: () => { line: number; hash: string } | null
  } = $props()

  let host = $state<HTMLDivElement>()
  let view: EditorView | null = null
  let empty = $state(true)
  let focused = $state(false)

  function flush() {
    save.cancel()
    const at = anchor()
    if (!view || !at) return
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
          save()
        },
        notes: links.index(path),
        openNote: followNote,
        openLink: followHref,
        writeLink: pickedLink,
        shortcuts: shortcuts.forEditor,
        propertyChoices: PROPERTY_CHOICES,
        trustedMarkup: false,
      })
      made.dispatch({ effects: modeEffects(modes.settings) })
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
    // Escape is the view's own, once the editor has had no use for it.
    if (event.key === 'Escape') view?.contentDOM.blur()
  }}
>
  <div class="host" bind:this={host}></div>
  {#if empty && !focused}
    <span class="placeholder" aria-hidden="true">{t('Description')}</span>
  {/if}
</div>

<style>
  /* A note's editor at the size of the words around it: a row's type rather than the
     page's, and none of the page's margins or height. */
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
