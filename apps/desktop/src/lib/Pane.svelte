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
  import type { Pane } from './workspace/pane-tree'
  import type { Landing } from './workspace/panes.svelte'
  import Canvas from './Canvas.svelte'
  import { dragged, draggedTab, isTabDrag, isTreeDrag } from './drag-paths'
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
  import { EDGE, inside, type Zone, zoneAt } from './workspace/zones'

  const { pane }: { pane: Pane } = $props()

  const tab = $derived(workspace.showing(pane.id))
  /** Every note this pane holds. The editor keeps a state for each one it has
   *  shown, and this is what tells it which of them are still open. */
  const strip = $derived(workspace.tabsIn(pane.id).map(noteKey))
  /** The strips live in the panes as soon as there is more than one of them.
   *  With one pane the window's own strip is in the titlebar, where a browser
   *  puts it and where it has been all along. */
  const stripped = $derived(workspace.panes.count > 1)
  /** Whether what is showing takes a dropped note itself; see `answers`. */
  const ownSurface = $derived(tab?.kind === 'canvas')

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

  /** Which zone of this pane a drop would land in. The sides this pane cannot
   *  split into are not offered, so a zone that would do nothing never lights;
   *  see workspace/zones.ts. */
  function zoneOf(event: DragEvent & { currentTarget: HTMLElement }): Zone {
    const box = event.currentTarget.getBoundingClientRect()
    const moving = workspace.panes.dragging?.tabId ?? null

    return zoneAt(box, event.clientX, event.clientY, (side) =>
      workspace.canLand(side, pane.id, moving),
    )
  }

  /** Whether the pane answers for a drop, or leaves it to what is showing: a
   *  canvas makes a card of a note dropped on it, so the middle of the pane is
   *  the canvas's and only the four sides are the pane's. A tab is nothing the
   *  canvas knows about, so a tab is always the pane's. */
  function answers(event: DragEvent, zone: Zone): boolean {
    if (isTabDrag(event.dataTransfer)) return true

    return isTreeDrag(event.dataTransfer) && !(ownSurface && zone === 'middle')
  }

  function over(event: DragEvent & { currentTarget: HTMLElement }) {
    const where = zoneOf(event)
    if (!answers(event, where)) {
      if (workspace.panes.landing?.paneId === pane.id) workspace.panes.landing = null
      return
    }

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    workspace.panes.landing = { kind: 'pane', paneId: pane.id, zone: where }
  }

  function drop(event: DragEvent & { currentTarget: HTMLElement }) {
    const where = zoneOf(event)
    if (!answers(event, where)) return

    event.preventDefault()
    const landing: Landing = { kind: 'pane', paneId: pane.id, zone: where }
    const id = draggedTab(event.dataTransfer)
    const paths = dragged(event.dataTransfer)

    workspace.panes.landing = null
    workspace.panes.dragging = null

    if (id) workspace.dropTab(id, landing)
    else if (paths.length) void workspace.dropNotes(paths, landing)
  }

  /** The zone of this pane the drop would land in, or undefined when the drag is
   *  somewhere else: over another pane, or over a strip, which marks its own
   *  place between the tabs. */
  const landing = $derived(workspace.panes.landing)
  const zone = $derived(
    landing?.kind === 'pane' && landing.paneId === pane.id ? landing.zone : undefined,
  )
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane"
  onpointerdowncapture={() => workspace.focusPane(pane.id)}
  ondragover={over}
  ondragleave={(event) => {
    // `dragleave` fires for a pointer moving onto the strip or the note inside
    // this pane as well as for one leaving it. Geometry tells the two apart.
    const box = event.currentTarget.getBoundingClientRect()
    if (landing?.paneId !== pane.id || inside(box, event.clientX, event.clientY)) return

    workspace.panes.landing = null
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

  <!-- Five places a drop can land: the pane itself, and each of its four sides,
       where a pane of its own would go. Lit as the drag nears one. -->
  {#if workspace.panes.dragging}
    <!-- The bands are drawn as deep as the geometry reads them, from the one
         number that says how deep that is. -->
    <div class="zones" class:sides={ownSurface} style:--band="{EDGE * 100}%">
      <div class="zone whole" class:lit={zone === 'middle'}></div>
      <div class="zone left" class:lit={zone === 'left'}></div>
      <div class="zone right" class:lit={zone === 'right'}></div>
      <div class="zone up" class:lit={zone === 'top'}></div>
      <div class="zone down" class:lit={zone === 'bottom'}></div>
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
     has none: its tabs are in the titlebar, where a browser puts them.

     Above the drop zones, so a tab dragged onto the strip reaches the strip and
     lands between the tabs rather than being taken by the pane underneath. */
  .head {
    position: relative;
    z-index: 6;
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
    /* The zones themselves take the drag, not the gaps between them: a canvas
       has to keep the middle of the pane, which is a card's place to land. */
    pointer-events: none;
  }

  /* A surface that takes a note dropped on it keeps the middle of the pane. */
  .zones.sides .zone.whole {
    pointer-events: none;
  }

  .zone {
    position: absolute;
    pointer-events: auto;
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

  .zone.left {
    inset: 0 auto 0 0;
    width: var(--band);
  }

  .zone.right {
    inset: 0 0 0 auto;
    width: var(--band);
  }

  .zone.up {
    inset: 0 0 auto 0;
    height: var(--band);
  }

  .zone.down {
    inset: auto 0 0 0;
    height: var(--band);
  }
</style>
