<script lang="ts">
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  // The kind of file a row is, under a name of its own: `FileMark` here is the
  // component that draws one.
  import { fileMark, type FileMark as Mark } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { folderFor, folderNote, folderNotePath, nestedIn, renameSteps } from './folder-notes'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { longPress } from './longpress'
  import { movesInto } from './move-targets'
  import NameField from './NameField.svelte'
  import { extensionOf } from './naming'
  import { shownName } from './note-name'
  import { rowMenu } from './row-menu'
  import { roving } from './roving'
  import SharedMark from './SharedMark.svelte'
  import { isSharedItem, othersIn } from './sharing.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { carried, carriedNothing, carry, dragged, isTreeDrag } from './drag-paths'
  import { dropTarget, targetFor } from './drop-target.svelte'
  import { treeStep, TREE_MOVES } from './tree-keys'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { inside } from './workspace/zones'
  import Tree from './Tree.svelte'
  import Twist from './Twist.svelte'
  import { dur } from './motion'

  const { entries, depth = 0 }: { entries: Entry[]; depth?: number } = $props()

  /** Whether the name being typed cannot be written, which the row wears as a
   *  hairline in red; the field is what knows why. One flag for the list, because
   *  one row at a time is being named. */
  let wrong = $state(false)

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

  /** Left and right in a list that holds lists: right shows what a row holds and
   *  then steps into it, left hides it again and otherwise steps out to the row
   *  holding this one. The rule is tree-keys.ts; up and down are the walk every
   *  list shares. True when the press was spent. */
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

  /** Enter on a row: it opens, and the note takes the keyboard, which is what
   *  `takesCaret` does a frame later.
   *
   *  Every row opens something, because every row is a note or a file: a folder
   *  opens the note it is drawn as, written or not. What a row holds is the two
   *  arrows and the twist, never Enter. See `openRow` in workspace.svelte.ts. */
  function openRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here !== undefined) void workspace.openRow(here)
  }

  /** Space on a row: the same, except the keyboard stays in the list, so a space
   *  can be walked and read down without leaving it. Obsidian has the same idea on
   *  Ctrl and an arrow. */
  function peekRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here === undefined) return

    void workspace.openRow(here, { preview: true })
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

  /** What the name field starts with. Nothing at all for a row that is being
   *  made: the name is what will make it. A note waiting for a title starts with
   *  the name it has and a space, so typing one adds to it. */
  function nameToEdit(entry: Entry): string {
    if (workspace.naming?.making) return ''

    const name = entry.is_dir ? entry.name : shownName(entry.name)
    return workspace.naming?.appending ? `${name} ` : name
  }

  /** The mark in front of the name: the note's own, so the row being renamed wears
   *  the one it wore a moment ago.
   *
   *  A folder with no note of its own is a page with nothing written on it, which
   *  is what `file` draws and what the row is: nothing has been written there yet.
   *  Asked of the folder rather than of its name, because a folder's name is not a
   *  file name - a vault with a folder called `Papers.pdf` is not holding a paper.
   *  See file-mark.ts. */
  function markOf(entry: Entry, own: Entry | null): Mark {
    if (own) return fileMark(own.name)
    return entry.is_dir ? 'file' : fileMark(entry.name)
  }

  /** Whose icon it is: the note's where the row has one, and the folder's while it
   *  has none - which is the one thing the space's icon map is still for. Either
   *  way `chosen-icon.ts` reads both, so a folder that wore an icon before
   *  anybody wrote in it keeps it afterwards. */
  function markPath(entry: Entry, own: Entry | null): string {
    return own?.path ?? entry.path
  }

  /** What the name that was typed does: makes the row that does not exist yet,
   *  renames the folder and the note inside it together, or renames the one file
   *  the row is. Which steps a row that is a folder takes is folder-notes.ts. */
  function commit(entry: Entry, own: Entry | null, name: string) {
    if (workspace.naming?.making) void workspace.makeNamed(name)
    else if (own) void renameNested(own, name)
    else void workspace.rename(entry.path, name)
  }

  /** Renaming a row that is a folder and a note renames both, in the order
   *  folder-notes.ts gives them. Each step is the ordinary rename, so the links
   *  are rewritten and the file undo has each half of it. */
  async function renameNested(note: Entry, name: string) {
    for (const step of renameSteps(note.path, name)) {
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
   *  zones do: a row held over itself, over a row inside it, or over the row it
   *  already sits in used to light and then move nothing.
   *
   *  A note held over itself is the same nothing, and the row itself is what says
   *  so: the folder a drop would make out of a note does not exist yet, so no rule
   *  about paths can tell it from the note it would be made of. */
  function takes(entry: Entry): boolean {
    const paths = carried()
    if (paths.includes(entry.path)) return false

    return paths.length === 0 || movesInto(paths, targetFor(entry.path, entry.is_dir))
  }

  /** Whether a drop would land in this row: in the folder it is, or in the folder
   *  the note it shows is about to become. A PDF or a canvas becomes no folder, so
   *  `folderFor` answers its own path back and its row never lights - the row of
   *  the folder it sits in lights instead, as it always has. */
  function nesting(entry: Entry): boolean {
    return dropTarget.lit(entry.is_dir ? entry.path : folderFor(entry.path))
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

  /** Clicking the row opens what it is; clicking the twist at the end of it shows
   *  what it holds. One button rather than two, because the row is also a drag
   *  handle, a drop target and where the keyboard stands, and none of those can be
   *  half a row - and a button cannot hold a button. The arrows are the twist for
   *  a keyboard; see tree-keys.ts.
   *
   *  One rule for every row in the list, which is what makes the list one list:
   *  the name opens the thing, the twist discloses it. A folder that has no note
   *  of its own opens the empty page it is - see `openRow` in workspace.svelte.ts
   *  - and writes nothing by being looked at. */
  function openRowAt(event: MouseEvent, entry: Entry) {
    const twist = event.target instanceof Element ? event.target.closest('.twist') : null
    if (twist) {
      workspace.toggleFolder(entry.path)
      return
    }

    if (!pick(event, entry)) void workspace.openRow(entry.path, { preview: true })
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
    <!-- What the row discloses: everything the folder holds, except the note it is
         itself drawn as, which is this row. -->
    {@const nested = own ? nestedIn(entry) : entry.children}
    <!-- A folder nobody has written a note in: a row of somebody else's vault,
         drawn quietly until there are words in it. -->
    {@const unwritten = entry.is_dir && !own}
    <!-- What the row opens. A folder opens its own note, the one it has or the one
         it would have; anything else opens itself. -->
    {@const opens = own?.path ?? (entry.is_dir ? folderNotePath(entry.path) : entry.path)}
    <!-- What it is called: the folder's name where the row is a folder, so a row
         whose note is somebody else's `index.md` is still called after its place. -->
    {@const name = entry.is_dir ? entry.name : shownName(entry.name)}
    <li>
      {#if workspace.naming?.path === entry.path}
        <!-- The row while its name is being typed. Its mark, its indentation, its
             height, its font, the fill that says it is the note you have open, the
             twist at the far end and the rows it discloses all stay exactly as they
             were: renaming a file changes its name and nothing else about it. Only
             the name becomes a field, in the slot the name was already in; see
             NameField.svelte.
             A div rather than the button a row usually is, for two reasons that
             point the same way: a button cannot hold a field, and a row whose name
             is being typed is not a row to press. -->
        <div
          class="nib-row row"
          class:is-quiet={unwritten}
          class:is-on={workspace.active?.path === opens}
          class:is-picked={workspace.isSelected(entry.path)}
          class:is-wrong={wrong}
          style:--level={depth}
        >
          <FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />
          <NameField
            value={nameToEdit(entry)}
            extension={extensionOf(entry.name, entry.is_dir)}
            taken={workspace.namesBeside(entry.path)}
            appending={workspace.naming.appending}
            bind:wrong
            oncommit={(typed: string) => commit(entry, own, typed)}
            oncancel={() => workspace.cancelNaming()}
          />
          {#if nested.length}{@render twist(entry.path)}{/if}
        </div>
      {:else}
        <!-- One row, because the list shows one kind of thing: a note, which may
             hold other notes. The mark says which kind of file it is, the name is
             the note's, and the twist at the far end appears only where there is
             something under it - a vault may arrive with a folder holding nothing
             but its own note, and a twist that opens on to nothing is a row
             promising something it does not have.
             A folder with no note of its own is the same row drawn quietly: it is
             a note nobody has written, and clicking it opens the empty page it is
             without writing anything. See folder-notes.ts and docs/tree.md. -->
        <button
          class="nib-row row"
          data-path={entry.path}
          class:is-left-out={workspace.excluded.has(entry.path)}
          class:is-quiet={unwritten}
          class:is-taking={nesting(entry)}
          class:is-on={workspace.active?.path === opens}
          class:is-picked={workspace.isSelected(entry.path)}
          style:--level={depth}
          aria-expanded={entry.is_dir ? workspace.isExpanded(entry.path) : undefined}
          draggable="true"
          onclick={(event) => openRowAt(event, entry)}
          ondblclick={() => workspace.openRow(entry.path)}
          oncontextmenu={(event) => menu.show(event, rowMenu(entry), { title: name })}
          use:longPress={(event) => menu.show(event, rowMenu(entry), { title: name })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragend={endDrag}
          ondragover={(event) => overRow(event, entry)}
          ondragleave={(event) => stillInside(event) || dropTarget.clear()}
          ondrop={(event) => drop(event, entry)}
        >
          <!-- The row says what it opens into without spending a word on it, or
               wears the icon the note itself chose; the path is how it knows. -->
          <FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />
          <span class="nib-row-label">{name}</span>
          <!-- Somebody else is in this note. The same mark the switcher puts on a
               shared space, in the slot a row keeps for what it has to add about
               a name; see SharedMark.svelte.
               Or, where nobody is in it this minute, that it is a file shared on
               its own: the same mark about the same fact, one step less urgent.
               Both about the note the row stands for, which for a row that holds
               notes is the note inside it. -->
          {#if othersIn(opens)}<SharedMark label={t('Also open elsewhere')} />
          {:else if isSharedItem(opens)}<SharedMark />{/if}
          {#if nested.length}{@render twist(entry.path)}{/if}
        </button>
      {/if}

      <!-- Outside the row rather than inside it, so a row keeps what it holds open
           while its own name is being typed: what a row discloses has nothing to do
           with what its name says. -->
      {#if entry.is_dir && workspace.isExpanded(entry.path)}
        <div transition:slide={{ duration: dur(190), easing: cubicOut }}>
          <Tree entries={nested} depth={depth + 1} />
        </div>
      {/if}
    </li>
  {/each}
</ul>

<!-- What a row holds, said at the far end of it. One twist, whether the row is
     being read or being renamed. -->
{#snippet twist(path: string)}
  <span class="nib-row-meta twist">
    <Twist open={workspace.isExpanded(path)} />
  </span>
{/snippet}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* A row the space leaves out of its own search, its picture and its mentions.
     Still there to open and still syncing, and saying quietly that the space has
     stopped asking it things. Opacity rather than a colour, so the mark in front
     of the name goes quiet with it. See workspace/excluded.svelte.ts. */
  .row.is-left-out {
    opacity: 0.5;
  }

  /* The row is drawn in the themes package - see `.nib-row` in base.css. What is
     left here is where it sits: one step in per level of the tree, on a property
     rather than a number in the markup, so a phone takes a deeper step without
     this component knowing which kind of screen it is on. The outline's rows and
     the tag tree's are indented the same way. */
  .row {
    padding-left: calc(var(--row-pad) + var(--level, 0) * var(--row-indent));
  }

  /* What a row holds, said at the far end of it rather than in front of the name.
     The mark in front is the note's own and says what the row is, so it cannot say
     "open" as well - and a twist in front of it would push one name in the list out
     of the column every other name is read in. The row's own trailing slot, which is
     where a list already puts what a row counts; see `.nib-row-meta` in the themes
     package. */
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

  /* The open note's mark carries the accent. The name beside it is told apart by
     the fill under it and by its weight; the mark is the one place a colour of
     its own reads as the file being open rather than as the row being picked. */
  .row.is-on :global(.mark) {
    stroke: var(--accent);
    opacity: 1;
  }
</style>
