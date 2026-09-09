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
  import { folderFor, folderNote, nestedIn, renameSteps } from './folder-notes'
  import { key, t } from './i18n.svelte'
  import { bookmarkEntry, DIVIDER, iconEntries, menu, type MenuEntry } from './menu.svelte'
  import { longPress } from './longpress'
  import { movesInto, moveTargets, type MoveTarget } from './move-targets'
  import { shownName } from './note-name'
  import { roving } from './roving'
  import { caretAtEnd, selectAll } from './select-all'
  import { shortcuts } from './shortcuts.svelte'
  import { carried, carriedNothing, carry, dragged, isTreeDrag } from './drag-paths'
  import { dropTarget, targetFor } from './drop-target.svelte'
  import { treeStep, TREE_MOVES } from './tree-keys'
  import { viewport } from './viewport.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { inside } from './workspace/zones'
  import Tree from './Tree.svelte'
  import Twist from './Twist.svelte'
  import { dur } from './motion'

  const { entries, depth = 0 }: { entries: Entry[]; depth?: number } = $props()

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
      ...iconEntries(entry.path, true),
      ...bookmarkEntry(workspace.bookmarks.forEntry(entry)),
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

  /** A row that is a folder and the note inside it, so its menu is both: what the
   *  note offers about itself, and the folder's entries that still mean something
   *  once the row is drawn as a note. A new note goes inside it; renaming and
   *  moving take the folder and the note together; and deleting asks, because a
   *  row that looks like a note takes everything nested under it with it.
   *
   *  No Duplicate: a copy of a folder note would be a note called `A 2.md` inside
   *  `A/`, which is neither a nested note nor a note beside one. */
  function folderNoteMenu(entry: Entry, note: Entry): MenuEntry[] {
    return [
      { label: t('Open'), run: () => void workspace.openEntry(note.path) },
      DIVIDER,
      { label: t('New note'), run: () => void workspace.createNote(entry.path) },
      DIVIDER,
      { label: t('Rename'), run: () => workspace.startRenaming(entry.path) },
      ...moveEntry(entry),
      // The same call a plain note's row makes, on the note's own path: the icon
      // is written in the note's front matter, and the folder icon map has
      // nothing to do with a row that is drawn as a note.
      ...iconEntries(note.path),
      ...bookmarkEntry(workspace.bookmarks.forEntry(note)),
      DIVIDER,
      { label: t('Delete'), danger: true, run: () => void removeNested(entry, note) },
      ...undoEntry(),
    ]
  }

  /** Deleting the row deletes the folder, so it asks first: everything nested
   *  under the note goes with it, and a row drawn as a note does not look like
   *  something that holds anything. */
  async function removeNested(entry: Entry, note: Entry) {
    const { prompt } = await import('./prompt.svelte')
    const sure = await prompt.confirm({
      title: t('Delete {name}?', { name: shownName(note.name) }),
      detail: t('The notes inside it go too.'),
      confirmLabel: key('Delete'),
      danger: true,
    })

    if (sure) await workspace.remove(entry.path, true)
  }

  function menuFor(entry: Entry, own: Entry | null): MenuEntry[] {
    const several = selectionMenu(entry)
    if (several) return several
    if (own) return folderNoteMenu(entry, own)

    return entry.is_dir ? folderMenu(entry) : noteMenu(entry)
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

  /** The row a press came from, by the path written on it. Null for a press
   *  from anywhere in the list that is not a row. */
  function rowPath(event: KeyboardEvent): string | null {
    const from = event.target instanceof Element ? event.target.closest('.row') : null
    return from instanceof HTMLElement ? (from.dataset.path ?? null) : null
  }

  /** The outermost list, which is the one every row is inside: this component
   *  draws one of itself per folder, and the row being stepped onto is usually in
   *  another of them. Only the outermost instance binds it, since only that one
   *  walks. */
  let list = $state<HTMLUListElement>()

  /** Puts the keyboard on a row and makes it the one selected, which is what
   *  arriving at a row in a file list means. The row is found in the page rather
   *  than held in state, for the reason above. */
  function stand(path: string) {
    workspace.select(path)
    const row = list?.querySelector(`.row[data-path="${CSS.escape(path)}"]`)
    if (row instanceof HTMLElement) row.focus()
  }

  /** Which of the walk's keys this press is, by the id the registry holds it
   *  under. Read off the registry rather than off the event, so a reader who
   *  rebinds one is obeyed; see tree-keys.ts. */
  function walkKey(event: KeyboardEvent): string | null {
    for (const [id, key] of TREE_MOVES) {
      if (shortcuts.pressed(id, event)) return key
    }

    return null
  }

  /** Keys that act on the selection, from anywhere in the tree. Which keys those
   *  are comes from the registry, like every other shortcut; they are read here
   *  rather than on the window because they only mean anything while the focus is
   *  in the list.
   *
   *  Walking the rows is not here: up, down, Home, End, spelling a name, Enter,
   *  Space, the menu key and Escape are the same in every list the app draws and
   *  are roving.ts, which the `<ul>` below is handed to. What is left is what only
   *  a list of files has - a selection, renaming, and the two keys that delete. */
  function onKey(event: KeyboardEvent) {
    // A row being renamed is a text field, and Escape, Ctrl+A and the arrows
    // belong to the words in it.
    if (event.target instanceof HTMLInputElement) return

    if (shortcuts.pressed('tree.select-all', event)) {
      event.preventDefault()
      workspace.selectAll()
      return
    }

    const deleting =
      shortcuts.pressed('tree.delete', event) || shortcuts.pressed('tree.delete.alt', event)
    if (deleting && workspace.selection.length) {
      event.preventDefault()
      void workspace.removeMany(workspace.selection)
      return
    }

    const here = rowPath(event)
    if (here === null) return

    if (shortcuts.pressed('tree.rename', event)) {
      event.preventDefault()
      workspace.startRenaming(here)
    }
  }

  /** Left and right in a list that holds lists: right opens a folder and then
   *  steps into it, left closes one and otherwise steps out to the folder holding
   *  this row. The rule is tree-keys.ts; up and down are the walk every list
   *  shares. True when the press was spent. */
  function sideways(key: string, row: HTMLElement): boolean {
    const here = row.dataset.path
    if (here === undefined) return false
    if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false

    const step = treeStep(key, workspace.visibleTree(), here)
    if (!step) return false

    if (step.do === 'stand') stand(step.path)
    else workspace.toggleFolder(step.path)

    return true
  }

  /** Enter on a row: a folder opens or shuts, and a note opens and the note takes
   *  the keyboard, which is what `takesCaret` does a frame later. */
  function openRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here === undefined) return

    // A folder holding its own note both holds rows and opens something, and Enter
    // does what a click does: opens it. The arrows are what fold it. A plain folder
    // has nothing to open and folds instead. See folder-notes.ts.
    const found = workspace.visibleTree().find((one) => one.path === here)
    if (found?.opens) void workspace.openEntry(found.opens)
    else if (found?.folder) workspace.toggleFolder(here)
    else void workspace.openEntry(here)
  }

  /** Space on a row: the same, except the keyboard stays in the list, so a folder
   *  can be walked and read down without leaving it. Obsidian has the same idea on
   *  Ctrl and an arrow. */
  function peekRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here === undefined) return

    const found = workspace.visibleTree().find((one) => one.path === here)
    if (found?.folder && !found.opens) {
      workspace.toggleFolder(here)
      return
    }

    void workspace.openEntry(found?.opens ?? here, { preview: true })
    row.focus()
  }

  /** Escape: the selection first, and once there is none the note takes the
   *  keyboard back. One level at a time, and never an action - the same order
   *  Obsidian's tree uses. True while the list still had something of its own. */
  function leaveList(): boolean {
    if (!workspace.selection.length) return false

    workspace.clearSelection()
    return true
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
      // Beside the name, because both are what the row shows.
      ...iconEntries(entry.path),
      ...bookmarkEntry(workspace.bookmarks.forEntry(entry)),
      // Duplicating copies a file's words, and a PDF has none: it would come out
      // as an empty file wearing the name of a paper.
      ...(isPdfTarget(entry.name)
        ? []
        : [{ label: t('Duplicate'), run: () => void workspace.duplicate(entry.path) }]),
      DIVIDER,
      { label: t('Delete'), danger: true, run: () => void workspace.remove(entry.path, false) },
      ...undoEntry(),
    ]
  }

  /** What the name field starts with. A note waiting for a title starts with the
   *  name it has and a space, so typing one adds to it. */
  function nameToEdit(entry: Entry): string {
    const name = entry.is_dir ? entry.name : shownName(entry.name)
    return workspace.renaming?.appending ? `${name} ` : name
  }

  /** Which way the field takes the caret; see select-all.ts. */
  function rename(node: HTMLInputElement, appending: boolean) {
    return appending ? caretAtEnd(node) : selectAll(node)
  }

  function commit(entry: Entry, own: Entry | null, typed: string) {
    workspace.stopRenaming()

    if (own) void renameNested(own, typed)
    else void workspace.rename(entry.path, fullName(entry, typed))
  }

  /** Renaming a row that is a folder and a note renames both, in the order
   *  folder-notes.ts gives them. Each step is the ordinary rename, so the links
   *  are rewritten and the file undo has each half of it. */
  async function renameNested(note: Entry, typed: string) {
    for (const step of renameSteps(note.path, typed)) {
      await workspace.rename(step.path, step.name)
    }
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
    carriedNothing()
  }

  /** A row lights only where a drop would do something, the way a pane's drop
   *  zones do: a folder held over itself, over a folder inside it, or over the
   *  folder it already sits in used to light and then move nothing.
   *
   *  A note held over itself is the same nothing, and the row itself is what says
   *  so: the folder a drop would make out of a note does not exist yet, so no rule
   *  about paths can tell it from the note it would be made of. */
  function takes(entry: Entry): boolean {
    const paths = carried()
    if (paths.includes(entry.path)) return false

    return paths.length === 0 || movesInto(paths, targetFor(entry.path, entry.is_dir))
  }

  /** Whether a drop would land in this note, which means in the folder it is about
   *  to become. A PDF or a canvas becomes no folder, so `folderFor` answers its own
   *  path back and its row never lights; the folder it sits in lights instead, as
   *  it always has. */
  function nesting(entry: Entry): boolean {
    return dropTarget.lit(folderFor(entry.path))
  }

  function overRow(event: DragEvent, entry: Entry) {
    if (!isTreeDrag(event.dataTransfer) || !takes(entry)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropTarget.over(targetFor(entry.path, entry.is_dir))
  }

  /** `dragleave` also fires when the pointer moves onto a child - the label
   *  inside a row, the icon inside a space - and the `dragover` that follows
   *  sets it straight back. That off-on-off is the flicker. Geometry settles
   *  it: still inside the box means still over the thing. */
  function stillInside(event: DragEvent): boolean {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return inside(box, event.clientX, event.clientY)
  }

  /** Into the folder the row stands for, which for a note is the folder that note
   *  is about to become; see drop-target.svelte.ts. Making it is the move's own
   *  business, so this is the same call every other drop makes. */
  function drop(event: DragEvent, entry: Entry) {
    event.preventDefault()
    dropTarget.clear()

    const paths = dragged(event.dataTransfer)
    if (paths.length) void workspace.moveMany(paths, targetFor(entry.path, entry.is_dir))
  }

  /** Clicking the row opens the note; clicking the twist at the end of it opens
   *  the folder. One button rather than two, because the row is also a drag
   *  handle, a drop target and where the keyboard stands, and none of those can be
   *  half a row - and a button cannot hold a button. The arrows are the twist for
   *  a keyboard; see tree-keys.ts. */
  function openNested(event: MouseEvent, entry: Entry, note: Entry) {
    const twist = event.target instanceof Element ? event.target.closest('.twist') : null
    if (twist) {
      workspace.toggleFolder(entry.path)
      return
    }

    if (!pick(event, entry)) void workspace.openEntry(note.path, { preview: true })
  }
</script>

<!-- Keys are read on the outermost list, where every row's keydown ends up: the
     selection keys here, and the walk every list in the app shares through the
     action; see roving.ts. The rows carry `is-on` for the note that is open, so Tab
     into the list arrives at the note being read rather than at the top of the
     space. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
  bind:this={list}
  onkeydown={depth === 0 ? onKey : undefined}
  use:roving={{
    inner: depth > 0,
    rows: '.row',
    keyOf: walkKey,
    sideways,
    open: openRow,
    peek: peekRow,
    menu: (row, at) => row.dispatchEvent(at),
    leave: leaveList,
  }}
>
  {#each entries as entry (entry.path)}
    <!-- The note a folder holds of its own name, which is the row the folder is
         drawn as; null for every other row. See folder-notes.ts. -->
    {@const own = folderNote(entry)}
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
          style:--level={depth}
          value={nameToEdit(entry)}
          spellcheck="false"
          use:rename={workspace.renaming.appending}
          onblur={(event) => commit(entry, own, event.currentTarget.value)}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              workspace.stopRenaming()
            }
          }}
        />
      {:else if own}
        <!-- A folder holding a note of its own name is drawn as that note and not
             as a folder: the note's mark, the note's name, and a twist at the far
             end for what is nested under it. The mark is the note's own, and so is
             the icon somebody chose for it, because the row hands FileMark the
             note's path - which is also why nothing about these rows is kept in
             the folder icon map.
             The note is not listed again among the children: it is this row. -->
        {@const nested = nestedIn(entry)}
        <button
          class="nib-row row note folder-note"
          data-path={entry.path}
          class:is-taking={dropTarget.lit(entry.path)}
          class:is-on={workspace.active?.path === own.path}
          class:is-picked={workspace.isSelected(entry.path)}
          style:--level={depth}
          aria-expanded={workspace.isExpanded(entry.path)}
          draggable="true"
          onclick={(event) => openNested(event, entry, own)}
          ondblclick={() => workspace.openEntry(own.path)}
          oncontextmenu={(event) =>
            menu.show(event, menuFor(entry, own), { title: shownName(own.name) })}
          use:longPress={(event) =>
            menu.show(event, menuFor(entry, own), { title: shownName(own.name) })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragend={endDrag}
          ondragover={(event) => overRow(event, entry)}
          ondragleave={(event) => stillInside(event) || dropTarget.clear()}
          ondrop={(event) => drop(event, entry)}
        >
          <FileMark mark={fileMark(own.name)} path={own.path} />
          <span class="nib-row-label">{shownName(own.name)}</span>
          <!-- Only while there is something to disclose. A vault may arrive with a
               folder holding nothing but its note, and a twist that opens on to
               nothing is a row promising something it does not have. -->
          {#if nested.length}
            <span class="nib-row-meta twist">
              <Twist open={workspace.isExpanded(entry.path)} />
            </span>
          {/if}
        </button>

        {#if workspace.isExpanded(entry.path)}
          <div transition:slide={{ duration: dur(190), easing: cubicOut }}>
            <Tree entries={nested} depth={depth + 1} />
          </div>
        {/if}
      {:else if entry.is_dir}
        <button
          class="nib-row row folder is-quiet"
          data-path={entry.path}
          class:is-taking={dropTarget.lit(entry.path)}
          class:is-picked={workspace.isSelected(entry.path)}
          style:--level={depth}
          aria-expanded={workspace.isExpanded(entry.path)}
          draggable="true"
          onclick={(event) => pick(event, entry) || workspace.toggleFolder(entry.path)}
          oncontextmenu={(event) => menu.show(event, menuFor(entry, own), { title: entry.name })}
          use:longPress={(event) => menu.show(event, menuFor(entry, own), { title: entry.name })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragend={endDrag}
          ondragover={(event) => overRow(event, entry)}
          ondragleave={(event) => stillInside(event) || dropTarget.clear()}
          ondrop={(event) => drop(event, entry)}
        >
          <!-- A folder says whether it is open by being open, in the slot the
               file marks sit in: one mark per row, and every name in the list
               starting at the same place. A folder that chose an icon of its own
               wears that instead, the same one open and shut - what it holds is
               said by the rows underneath it and by `aria-expanded`, and a chosen
               icon that changed as the folder opened would read as two folders. -->
          <FileMark
            mark={workspace.isExpanded(entry.path) ? 'folder-open' : 'folder'}
            path={entry.path}
          />
          <span class="nib-row-label">{entry.name}</span>
        </button>

        {#if workspace.isExpanded(entry.path)}
          <div transition:slide={{ duration: dur(190), easing: cubicOut }}>
            <Tree entries={entry.children} depth={depth + 1} />
          </div>
        {/if}
      {:else}
        <button
          class="nib-row row note"
          data-path={entry.path}
          class:is-taking={nesting(entry)}
          class:is-on={workspace.active?.path === entry.path}
          class:is-picked={workspace.isSelected(entry.path)}
          style:--level={depth}
          draggable="true"
          onclick={(event) =>
            pick(event, entry) || workspace.openEntry(entry.path, { preview: true })}
          ondblclick={() => workspace.openEntry(entry.path)}
          oncontextmenu={(event) =>
            menu.show(event, menuFor(entry, own), { title: shownName(entry.name) })}
          use:longPress={(event) =>
            menu.show(event, menuFor(entry, own), { title: shownName(entry.name) })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragend={endDrag}
          ondragover={(event) => overRow(event, entry)}
          ondragleave={(event) => stillInside(event) || dropTarget.clear()}
          ondrop={(event) => drop(event, entry)}
        >
          <!-- The row says what it opens into without spending a word on it, or
               wears the icon the note itself chose; the path is how it knows. -->
          <FileMark mark={fileMark(entry.name)} path={entry.path} />
          <span class="nib-row-label">{shownName(entry.name)}</span>
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

  /* The row is drawn in the themes package - see `.nib-row` in base.css. What is
     left here is where it sits: one step in per level of the tree, on a property
     rather than a number in the markup, so a phone takes a deeper step without
     this component knowing which kind of screen it is on. The outline's rows and
     the tag tree's are indented the same way. */
  .row,
  .rename {
    padding-left: calc(var(--row-pad) + var(--level, 0) * var(--row-indent));
  }

  /* What a folder note holds, said at the far end of the row rather than in front
     of the name. The mark in front is the note's own, so the row cannot say "open"
     with it the way a plain folder does - and a twist in front of the mark would
     push one name in the list out of the column every other name is read in.
     The row's own trailing slot, which is where a list already puts what a row
     counts; see `.nib-row-meta` in the themes package. */
  .twist {
    display: grid;
    place-items: center;
    padding: 0 var(--space-1);
  }

  /* The box the twist fills; the shape and the turn are Twist.svelte's, which the
     tag tree draws too. */
  .twist :global(svg) {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .rename {
    width: 100%;
    min-height: var(--row-height);
    padding-right: var(--row-pad);
    border: 1px solid var(--accent);
    border-radius: var(--radius-row);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    outline: none;
  }

  /* The open note's mark carries the accent. The name beside it is told apart by
     the fill under it and by its weight; the mark is the one place a colour of
     its own reads as the file being open rather than as the row being picked. */
  .note.is-on :global(.mark) {
    stroke: var(--accent);
    opacity: 1;
  }
</style>
