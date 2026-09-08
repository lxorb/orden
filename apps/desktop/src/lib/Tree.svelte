<script module lang="ts">
  /** Folders keep their name; notes keep their extension. */
  function fullName(entry: { is_dir: boolean; name: string }, typed: string): string {
    if (entry.is_dir) return typed
    const extension = /\.[^.]+$/.exec(entry.name)?.[0] ?? '.md'
    return typed.endsWith(extension) ? typed : typed + extension
  }
</script>

<script lang="ts">
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { isPdfTarget } from '@nib/markdown/links'
  import { fileMark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { t } from './i18n.svelte'
  import {
    bookmarkEntry,
    copyPathEntry,
    DIVIDER,
    menu,
    type MenuEntry,
    revealEntry,
  } from './menu.svelte'
  import { longPress } from './longpress'
  import { moveTargets, type MoveTarget } from './move-targets'
  import { caretAtEnd, selectAll } from './select-all'
  import { shortcuts } from './shortcuts.svelte'
  import { carry, dragged, isTreeDrag } from './drag-paths'
  import { folderOf } from './tauri'
  import { viewport } from './viewport.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { inside } from './workspace/zones'
  import Tree from './Tree.svelte'

  const { entries, depth = 0 }: { entries: Entry[]; depth?: number } = $props()

  let dropTarget = $state<string | null>(null)

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  /** Moving a row, where a drag is not available.
   *
   *  A held finger opens this menu before a drag could start, and the browser
   *  fires no drag events from a touch anyway, so on a phone or a tablet the only
   *  outcome of pressing a row was the menu. So the menu offers the move: the
   *  places it could have been dropped, in the sheet every other question uses.
   *  Nothing is offered on a desktop, where the pointer already does it. */
  function moveEntry(entry: Entry): MenuEntry[] {
    if (!viewport.touch) return []

    const targets = moveTargets({
      moving: entry.path,
      tree: workspace.tree,
      spaces: workspace.spaces,
      here: workspace.activeSpace?.root ?? null,
    })
    if (!targets.length) return []

    return [{ label: t('Move'), run: () => void moveTo(entry, targets) }]
  }

  async function moveTo(entry: Entry, targets: readonly MoveTarget[]) {
    const { prompt } = await import('./prompt.svelte')
    const into = await prompt.find({
      title: t('Move to'),
      options: targets.map((one) => ({ id: one.id, label: one.label })),
      placeholder: t('Folder'),
    })

    // The same call the drop makes, so it is the same move and the same undo.
    if (into) await workspace.moveMany([entry.path], into)
  }

  function folderMenu(entry: Entry): MenuEntry[] {
    return [
      { label: t('New note'), run: () => void workspace.createNote(entry.path) },
      { label: t('New canvas'), run: () => void workspace.createCanvas(entry.path) },
      { label: t('New folder'), run: () => void workspace.createFolder(entry.path) },
      DIVIDER,
      { label: t('Rename'), run: () => workspace.startRenaming(entry.path) },
      ...moveEntry(entry),
      ...bookmarkEntry(workspace.bookmarks.forEntry(entry)),
      ...revealEntry(entry.path),
      DIVIDER,
      { label: t('Delete'), danger: true, run: () => void workspace.remove(entry.path, true) },
      ...undoEntry(),
    ]
  }

  /** A row that is part of a selection of several stands for all of them:
   *  its menu acts on the lot, and offers only what makes sense for a lot. */
  function selectionMenu(entry: Entry): MenuEntry[] | null {
    if (!workspace.isSelected(entry.path) || workspace.selection.length < 2) return null
    const count = workspace.selection.length
    return [
      {
        label: t('Delete {count} items', { count }),
        danger: true,
        run: () => void workspace.removeMany(workspace.selection),
      },
      ...undoEntry(),
    ]
  }

  function menuFor(entry: Entry): MenuEntry[] {
    return selectionMenu(entry) ?? (entry.is_dir ? folderMenu(entry) : noteMenu(entry))
  }

  /** Ctrl and Shift build a selection and do nothing else; a plain click makes
   *  the row the one selected and goes on to what it always did. Returns
   *  whether the click was taken by the selection. */
  function pick(event: MouseEvent, entry: Entry): boolean {
    if (event.ctrlKey || event.metaKey) {
      workspace.toggleSelect(entry.path)
      return true
    }
    if (event.shiftKey) {
      workspace.selectRange(entry.path)
      return true
    }
    workspace.select(entry.path)
    return false
  }

  /** Keys that act on the selection, from anywhere in the tree. Which keys
   *  those are comes from the registry, like every other shortcut; they are
   *  read here rather than on the window because they only mean anything
   *  while the focus is in the list. */
  function onKey(event: KeyboardEvent) {
    if (shortcuts.pressed('tree.select-all', event)) {
      event.preventDefault()
      workspace.selectAll()
      return
    }
    if (shortcuts.pressed('tree.deselect', event)) {
      workspace.clearSelection()
      return
    }

    const deleting =
      shortcuts.pressed('tree.delete', event) || shortcuts.pressed('tree.delete.alt', event)
    if (deleting && workspace.selection.length) {
      event.preventDefault()
      void workspace.removeMany(workspace.selection)
    }
  }

  /** Only offered once there is something to take back. */
  function undoEntry(): MenuEntry[] {
    const label = workspace.undoLabel
    return label ? [DIVIDER, { label, run: () => void workspace.undoFileAction() }] : []
  }

  function noteMenu(entry: Entry): MenuEntry[] {
    return [
      { label: t('Open'), run: () => void workspace.openEntry(entry.path) },
      DIVIDER,
      { label: t('Rename'), run: () => workspace.startRenaming(entry.path) },
      ...moveEntry(entry),
      ...bookmarkEntry(workspace.bookmarks.forEntry(entry)),
      // Duplicating copies a file's words, and a PDF has none: it would come out
      // as an empty file wearing the name of a paper.
      ...(isPdfTarget(entry.name)
        ? []
        : [{ label: t('Duplicate'), run: () => void workspace.duplicate(entry.path) }]),
      ...copyPathEntry(entry.path),
      ...revealEntry(entry.path),
      DIVIDER,
      { label: t('Delete'), danger: true, run: () => void workspace.remove(entry.path, false) },
      ...undoEntry(),
    ]
  }

  /** What the name field starts with. A note waiting for a title starts with the
   *  name it has and a space, so typing one adds to it. */
  function nameToEdit(entry: Entry): string {
    const name = entry.is_dir ? entry.name : stripped(entry.name)
    return workspace.renaming?.appending ? `${name} ` : name
  }

  /** Which way the field takes the caret; see select-all.ts. */
  function rename(node: HTMLInputElement, appending: boolean) {
    return appending ? caretAtEnd(node) : selectAll(node)
  }

  function commit(path: string, value: string) {
    workspace.stopRenaming()
    void workspace.rename(path, value)
  }

  function startDrag(event: DragEvent, path: string) {
    carry(event.dataTransfer, workspace.dragPayload(path))
    // The panes light their drop zones for a note out of the list as well as
    // for a tab out of a strip: both land in the same five places.
    workspace.panes.dragging = { tabId: null }
  }

  function endDrag() {
    workspace.panes.dragging = null
    workspace.panes.landing = null
  }

  function overFolder(event: DragEvent, path: string) {
    if (!isTreeDrag(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropTarget = path
  }

  /** `dragleave` also fires when the pointer moves onto a child - the label
   *  inside a row, the icon inside a space - and the `dragover` that follows
   *  sets it straight back. That off-on-off is the flicker. Geometry settles
   *  it: still inside the box means still over the thing. */
  function stillInside(event: DragEvent): boolean {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return inside(box, event.clientX, event.clientY)
  }

  function drop(event: DragEvent, folder: string) {
    event.preventDefault()
    dropTarget = null

    const paths = dragged(event.dataTransfer)
    if (paths.length) void workspace.moveMany(paths, folder)
  }

  /** A note is a target too, standing for the folder it sits in. Without this
   *  the only way out of a folder would be another folder to drop onto, and a
   *  space with one folder in it would be a trap. */
  function dropBeside(event: DragEvent, path: string) {
    event.preventDefault()
    dropTarget = null

    const paths = dragged(event.dataTransfer)
    if (paths.length) void workspace.moveMany(paths, folderOf(path))
  }
</script>

<!-- Keys are read on the outermost list, where every row's keydown ends up. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul onkeydown={depth === 0 ? onKey : undefined}>
  {#each entries as entry (entry.path)}
    <li>
      {#if workspace.renaming?.path === entry.path}
        <!-- The name arrives selected, the way every file manager does it:
             renaming usually replaces the name rather than adding to it. The
             value already leaves the extension off, so this selects the name
             and nothing else.
             A note made with a name of its own is the exception: a unique
             note's timestamp is waiting for a title after it, so the caret
             goes to the end and the space is already there. -->
        <input
          class="rename"
          style:padding-left="{depth * 12 + 8}px"
          value={nameToEdit(entry)}
          spellcheck="false"
          use:rename={workspace.renaming.appending}
          onblur={(event) => commit(entry.path, fullName(entry, event.currentTarget.value))}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              workspace.stopRenaming()
            }
          }}
        />
      {:else if entry.is_dir}
        <button
          class="row folder"
          class:dropping={dropTarget === entry.path}
          class:selected={workspace.isSelected(entry.path)}
          style:padding-left="{depth * 12 + 8}px"
          aria-expanded={workspace.isExpanded(entry.path)}
          draggable="true"
          onclick={(event) => pick(event, entry) || workspace.toggleFolder(entry.path)}
          oncontextmenu={(event) => menu.show(event, menuFor(entry), { title: entry.name })}
          use:longPress={(event) => menu.show(event, menuFor(entry), { title: entry.name })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragend={endDrag}
          ondragover={(event) => overFolder(event, entry.path)}
          ondragleave={(event) => stillInside(event) || (dropTarget = null)}
          ondrop={(event) => drop(event, entry.path)}
        >
          <svg class="chevron" class:open={workspace.isExpanded(entry.path)} viewBox="0 0 8 8">
            <path d="M2 1l3 3-3 3" />
          </svg>
          <span class="label">{entry.name}</span>
        </button>

        {#if workspace.isExpanded(entry.path)}
          <div transition:slide={{ duration: 190, easing: cubicOut }}>
            <Tree entries={entry.children} depth={depth + 1} />
          </div>
        {/if}
      {:else}
        <button
          class="row note"
          class:active={workspace.active?.path === entry.path}
          class:dropping={dropTarget === entry.path}
          class:selected={workspace.isSelected(entry.path)}
          style:padding-left="{depth * 12 + 8}px"
          draggable="true"
          onclick={(event) =>
            pick(event, entry) || workspace.openEntry(entry.path, { preview: true })}
          ondblclick={() => workspace.openEntry(entry.path)}
          oncontextmenu={(event) =>
            menu.show(event, menuFor(entry), { title: stripped(entry.name) })}
          use:longPress={(event) =>
            menu.show(event, menuFor(entry), { title: stripped(entry.name) })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragend={endDrag}
          ondragover={(event) => overFolder(event, entry.path)}
          ondragleave={(event) => stillInside(event) || (dropTarget = null)}
          ondrop={(event) => dropBeside(event, entry.path)}
        >
          <!-- In the slot the chevron sits in, so a name lines up whatever kind
               of file it is: the row says what it opens into without spending a
               word on it. -->
          <FileMark mark={fileMark(entry.name)} />
          <span class="label">{stripped(entry.name)}</span>
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .row:hover {
    background: var(--item-hover-bg-color);
    color: var(--item-hover-text-color);
  }

  /* Opening a note, folding a folder and renaming all wait on a file, so the
     row itself says the click landed. */
  .row:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* The open note is told apart by weight and colour alone. A background
     would read as a selection, which it is not: switching tabs picks nothing
     in the list, the way a click in the list does. */
  .note.active {
    color: var(--active-file-text-color);
    font-weight: 550;
  }

  .folder {
    color: var(--muted);
  }

  /* Picked with Ctrl or Shift. The open note keeps its own look on top. */
  .row.selected {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .row.dropping {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
    color: var(--text-strong);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    width: 100%;
    padding: 4px 8px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
  }

  .chevron {
    width: 8px;
    height: 8px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    transition: transform var(--dur-base) var(--ease-out);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /* The open note's mark carries the accent. The name beside it is told apart by
     weight and colour, and the mark is the one place a colour of its own reads as
     the file being open rather than as the row being picked. */
  .note.active :global(.mark) {
    stroke: var(--accent);
    opacity: 1;
  }

  /* A 25px row is a desktop row. A thumb needs the whole line, and the tree is
     the main thing anyone taps in the drawer. */
  :global([data-touch]) .row {
    min-height: 48px;
    padding-top: 0;
    padding-bottom: 0;
    font-size: var(--text-base);
  }

  :global([data-touch]) .rename {
    min-height: 48px;
    font-size: var(--text-base);
  }
</style>
