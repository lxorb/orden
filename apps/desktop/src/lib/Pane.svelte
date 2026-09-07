<script lang="ts">
  /** One pane: its strip of tabs and the note, or the graph, that is showing in
   *  it. A window has one of these until something is split, and up to four
   *  after that.
   *
   *  Everything a pane's editor needs to know about is asked of the tab in this
   *  pane rather than of the window: which note a pasted picture belongs beside,
   *  which note a link is being followed from. Two panes on two notes would
   *  otherwise both answer for whichever one had the focus. */

  import { type EditorView, type NoteJump, setDeck } from '@nib/editor'
  import { isDeck } from '@nib/markdown/slides'
  import type { Tab } from './workspace.svelte'
  import type { Along, Pane } from './workspace/pane-tree'
  import Canvas from './Canvas.svelte'
  import { draggedTab, isTabDrag } from './drag-paths'
  import { noteKey } from './editor-states'
  import Editor from './Editor.svelte'
  import Graph from './Graph.svelte'
  import { key, message, t } from './i18n.svelte'
  import { busy } from './busy.svelte'
  import { showEditorMenu } from './editor-menu'

  import { links } from './link-index.svelte'
  import { modes } from './modes.svelte'
  import { notePicture } from './note-images'
  import Pdf from './Pdf.svelte'
  import { placement } from './placement.svelte'
  import Reading from './Reading.svelte'
  import { settings } from './settings.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { storeImage } from './assets'
  import Tabs from './Tabs.svelte'
  import { openExternal } from './tauri'
  import { usage } from './usage.svelte'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'

  const { pane }: { pane: Pane } = $props()

  const tab = $derived(workspace.showing(pane.id))
  /** Every note this pane holds. The editor keeps a state for each one it has
   *  shown, and this is what tells it which of them are still open. */
  const strip = $derived(workspace.tabsIn(pane.id).map(noteKey))
  /** The strips live in the panes as soon as there is more than one of them.
   *  With one pane the window's own strip is in the titlebar, where a browser
   *  puts it and where it has been all along. */
  const stripped = $derived(workspace.panes.count > 1)

  let view = $state<EditorView>()

  // Every editor on the page is one the modes, the keys and the palette have to
  // reach, and a view is built fresh for every tab.
  $effect(() => {
    const current = view
    if (!current) return

    views.put(pane.id, current)
    modes.apply(current)
    shortcuts.apply(current)

    return () => {
      views.forget(pane.id)
      modes.forget(current)
      shortcuts.forget(current)
    }
  })

  // Reopening a note lands where it was left; see placement.svelte.ts. Per pane,
  // because a note open in two panes is being read in two places.
  $effect(() => {
    const current = view
    const showing = tab
    if (!current || !showing) return

    return placement.follow(current, showing)
  })

  // Whether this pane's note is a deck, which is what marks the rules that break
  // it into slides. Read off the words as of the last pause in the typing, like
  // the outline: `tab.doc` is only brought forward when the typing stops, so this
  // costs one scan per pause rather than one per keystroke.
  $effect(() => {
    const current = view
    const words = tab?.doc
    if (!current || words === undefined) return

    setDeck(current, isDeck(words))
  })

  /** A pasted or dropped image, stored once however often it is pasted. A large
   *  screenshot takes a moment to hash and write, and nothing appears in the
   *  note until it has, so the line at the top says so meanwhile.
   *
   *  Which note the picture belongs beside comes from the tab that was written
   *  in, not from the pane: the pane's editor outlives the note in it. */
  async function saveImage(file: File, into: Tab): Promise<string | null> {
    try {
      const src = await busy.run(t('Storing the image'), () => storeImage(file, into.path))
      void usage.refresh()
      return src
    } catch (error) {
      // The one failure worth interrupting for: nothing else the editor does
      // will work either until something is deleted.
      void usage.refresh()
      settings.error = message(error, key('That image does not fit in your storage.'))
      return null
    }
  }

  function resolveImage(src: string, from: Tab): string {
    return notePicture(src, from.path, from.doc)
  }

  /** Names a block of another note, so a `[[…#^` link can point at it. */
  function nameBlock(path: string, line: number): Promise<string | null> {
    const root = workspace.activeSpace?.root
    return root ? links.nameBlock(path, line, root) : Promise.resolve(null)
  }

  /** How far into an edge a tab has to be held for the drop to make a pane
   *  there rather than joining this one's strip. */
  const EDGE = 0.28

  /** Which of the two edges the pointer is in, or null for the pane itself. The
   *  corner belongs to whichever edge it is further into. */
  function edgeAt(box: DOMRect, x: number, y: number): Along | null {
    const right = (x - box.left) / box.width - (1 - EDGE)
    const down = (y - box.top) / box.height - (1 - EDGE)

    if (right > 0 && down > 0) return right > down ? 'row' : 'column'
    if (right > 0) return 'row'
    if (down > 0) return 'column'

    return null
  }

  /** Where a drop would land, with the edges that this pane cannot split into
   *  reading as the pane itself: a zone that would do nothing does not light. */
  function landingAt(box: DOMRect, x: number, y: number): Along | null {
    const edge = edgeAt(box, x, y)
    return edge && workspace.panes.splittable(edge, pane.id) ? edge : null
  }

  function over(event: DragEvent & { currentTarget: HTMLElement }) {
    if (!isTabDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    const box = event.currentTarget.getBoundingClientRect()
    workspace.panes.landing = {
      paneId: pane.id,
      along: landingAt(box, event.clientX, event.clientY),
    }
  }

  function drop(event: DragEvent & { currentTarget: HTMLElement }) {
    const id = draggedTab(event.dataTransfer)
    workspace.panes.landing = null
    workspace.panes.dragging = null
    if (!id) return

    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    workspace.dropTab(id, pane.id, landingAt(box, event.clientX, event.clientY))
  }

  const landing = $derived(
    workspace.panes.landing?.paneId === pane.id ? workspace.panes.landing.along : undefined,
  )
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane"
  onpointerdowncapture={() => workspace.focusPane(pane.id)}
  ondragover={over}
  ondragleave={() => {
    if (workspace.panes.landing?.paneId === pane.id) workspace.panes.landing = null
  }}
  ondrop={drop}
>
  {#if stripped}
    <div class="head"><Tabs paneId={pane.id} /></div>
  {/if}

  {#if tab?.kind === 'graph'}
    <!-- The graph of the space is a tab like a note is, so it takes the note's
         place in the pane rather than a surface of its own. -->
    <Graph
      graph={links.graph}
      current={workspace.relativeNote}
      onopen={(path: string, keep: boolean) => workspace.openRelative(path, keep)}
      onescape={() => void workspace.closeAsking(tab.id)}
    />
  {:else if tab?.kind === 'canvas'}
    <!-- A plane of cards, in the note's place. Keyed like the reading view and a
         PDF: a canvas is a document of its own and nothing about it is swapped
         into an editor. -->
    {#key tab.id}
      <Canvas {tab} focused={workspace.panes.focusedId === pane.id} />
    {/key}
  {:else if tab?.kind === 'pdf'}
    <!-- A paper being read, beside the notes about it. Keyed like the reading
         view: a PDF is a document of its own and nothing about it is swapped
         into an editor. -->
    {#key tab.id}
      <Pdf {tab} focused={workspace.panes.focusedId === pane.id} />
    {/key}
  {:else if tab?.reading}
    <!-- The note through the renderer. A tab keeps its own face, so the same note
         can be read here and written in next door. -->
    {#key tab.id}
      <Reading {tab} focused={workspace.panes.focusedId === pane.id} />
    {/key}
  {:else if tab}
    <!-- One editor for the pane, whichever note is in it: switching swaps the
         note's state into it rather than building another editor, which is what
         makes a switch land in one frame. See Editor.svelte. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="editor" oncontextmenu={(event: MouseEvent) => showEditorMenu(event, view)}>
      <Editor
        bind:view
        {tab}
        kept={strip}
        onimage={saveImage}
        resolveimage={resolveImage}
        openlink={(href: string) => void openExternal(href)}
        notes={(one: Tab) => links.index(one.path)}
        opennote={(jump: NoteJump) => void workspace.followLink(jump)}
        nameblock={(path: string, line: number) => nameBlock(path, line)}
        onselection={(current: EditorView) => {
          views.moved(current)
          placement.remember(current)
        }}
      />
    </div>
  {/if}

  <!-- Lit as the tab nears an edge: this is where the pane would go. -->
  {#if workspace.panes.dragging}
    <div class="zones">
      <div class="zone right" class:lit={landing === 'row'}></div>
      <div class="zone down" class:lit={landing === 'column'}></div>
      <div class="zone whole" class:lit={landing === null}></div>
    </div>
  {/if}
</div>

<style>
  .pane {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* A pane beside another one carries its own strip. The window's single pane
     has none: its tabs are in the titlebar, where a browser puts them. */
  .head {
    display: flex;
    align-items: stretch;
    flex: none;
    height: var(--titlebar-height);
    border-bottom: 1px solid var(--line);
  }

  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }

  /* Over the note while a tab is being dragged, so the drop lands here rather
     than in the text. */
  .zones {
    position: absolute;
    inset: 0;
    z-index: 5;
  }

  .zone {
    position: absolute;
    background: var(--accent-soft);
    border: 1px solid transparent;
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      inset var(--dur-base) var(--ease-out);
  }

  .zone.lit {
    opacity: 1;
    border-color: var(--accent-line);
  }

  .zone.whole {
    inset: 0;
  }

  .zone.right {
    inset: 0 0 0 72%;
  }

  .zone.down {
    inset: 72% 0 0 0;
  }
</style>
