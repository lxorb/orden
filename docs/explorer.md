# The file explorer

A folder anywhere on the disk, in a tab (#1164). Like any tab it can go into a window of its
own, a split or the overview. The file list in the sidebar is still the spaces' own view,
with links, sync and Recently deleted. The explorer is for the rest of the disk.

It is called *File explorer* and not *Files*, because *Files* is already the name of the
sidebar's file list.

The comparison of file managers that this design comes from, and the reasons for each
choice, are on the issue.

## Where it is

- Desktop only. The browser build has no file system, and a phone's app storage holds only
  the spaces. Neither one offers the kind (`kindsHere` in `settings.svelte.ts`).
- You make one from the new tab's kinds (`F`), the palette, or `Ctrl+Alt+E` (`app.explorer`).
  A new one opens on the home folder.
- Its words are the folder it shows and the way back and forward (`explorer/spec.ts`), so a
  restart, the closed-tab stack and Duplicate carry it.
- The sort, the hidden files and whether the places show are set once for every tab and
  every folder (`explorer/prefs.svelte.ts`), never per folder.

## What is on screen

- **The bar.** Back and Forward are the app's own keys (`app.back`, `app.forward`), which an
  explorer answers with its folders, as a web tab answers with its pages. Then Up, and the
  path, one crumb per step. Click past the last crumb, or press `Ctrl+L`, to type a path:
  `~/`, a drive letter or `..` (`explorer/crumbs.ts`). Last come the hidden files and the
  places.
- **The places**: home, desktop, documents, downloads, pictures, music, videos, the spaces
  folder, the top of the disk, and the disks that are mounted (`explorer_places` in
  `explorer/listing.rs`). A pane narrower than 34rem hides them.
- **The folder**: a list with Name, Modified, Size and Kind. Click a column's head to sort
  by it. Folders come first, and names are sorted as the file manager beside the app sorts
  them (`explorer/order.ts`). A folder of any size draws only the rows in view.
- **The foot**: how many items there are and how much is picked.

The folder on screen is watched for other programs' changes (`explorer/watch.rs`) and
listed again once they stop.

## Keys

The keys a list of files shares with the file list (the arrows, Enter, `Ctrl+A`, Escape,
Shift with an arrow) are the file list's own entries, so one rebind moves both. Ctrl with
an arrow moves the keyboard without picking anything. Home, End and the page keys move
too. A letter jumps to the first name that starts with it. `Space` is kept for looking at a
file, and is never a selection mode.

| Key | |
| --- | --- |
| Backspace, Alt+Up (Cmd+Up on a Mac) | the folder above, with the one left picked |
| Alt+Left, Alt+Right | back, forward |
| Ctrl+L (Cmd+Shift+G) | type a path |
| Ctrl+H (Cmd+Shift+H) | hidden files |
| Enter, a double click | open |
| F2 (Cmd+Enter) | rename in place, with the name chosen and its ending left out |
| Ctrl+C, Ctrl+X, Ctrl+V | copy, cut, paste: the file list's own clipboard, so a row copied in either pastes in the other |
| Ctrl+Shift+N | a new folder, waiting for its name |
| Delete (Cmd+Backspace) | to the trash |
| Shift+Delete (Cmd+Alt+Backspace) | delete for good, after a question |
| Ctrl+Z, Ctrl+Y | undo, redo |
| Shift+F10, the menu key | the row's menu |

The mouse picks as in every file manager: a click, Ctrl and Shift with it, and a drag
from the room under the rows across the rows it covers (with Ctrl, added to what was
picked). The row's menu is short and the same every time: Open, Open with the system app
(for a file Orden opens), Show in the system's file manager, Cut, Copy, Paste into a
folder, Copy to and Move to the other pane where an explorer shows a folder there,
Duplicate, Rename, Copy path, Move to Trash and Delete for good. The room under the rows
has New folder, Paste, Hidden files and Show in the system's file manager.

## Finding and seeing

Three ways to find something, kept apart, because plain typing should never start a crawl
of the whole tree:

1. **Type-ahead**: a letter jumps to the first name that starts with it.
2. **Filter**: `Ctrl+F` opens a field in the bar that narrows the folder as you type.
3. **Search below**: `Enter` in the filter, or `Ctrl+Shift+F`, searches every folder below
   by name (`explorer_search`). Results arrive in batches as they are found. The Kind
   column becomes the folder each result is in. The search stops at 5,000 results or
   500,000 entries walked, and can be cancelled. `Escape` goes back to the folder.

Hidden names, and everything inside a hidden folder, are found only when hidden files are
shown.

**Preview pane** (`Alt+P`, `Cmd+Alt+P` on a Mac) shows the file the keyboard is on:
- a picture, a sound or a film, read through the window as a blob (at most 48 MB, and
  only kinds the engine plays);
- the first 64 KB of anything else that is UTF-8 text, as text and never as markup;
- below that, its facts: size, modified, created, permissions, where a link points, and
  its path. A folder can count what it holds, and the count stops when the keyboard moves
  on.

**Quick look** (`Space`) opens the same preview large over the tab. The arrows step through
the files, and `Space` or `Escape` puts it away.

**Grid** (`Ctrl+2`) draws the folder as tiles, with a picture's own thumbnail where it is
under 8 MB. **List** (`Ctrl+1`) is the default. The arrows walk the grid across and down.

## Opening

In a space, a file Orden opens (a note, canvas, page note, PDF, web shortcut, base, chat)
opens in a tab, exactly as it does from the file list. Everything else, and everything
outside the spaces, opens in the app the system opens it with (`explorer/open.ts`). Orden
opens nothing from outside its spaces (docs/conventions.md, Security). Whether that should
change for the explorer has been asked on the issue.

## What it may touch

`explorer/reach.rs` is a fifth judge beside the four in `paths.rs`:

- A folder is listed wherever the reader points the tab.
- Everything else reaches only what a tab has shown this run. A file is looked at, opened,
  copied, renamed, trashed or deleted only where its folder was listed, or a search showed
  it there. A copy or a move lands only in a folder that was listed. `Explored` hears every
  listing and every search and nothing else, so a path that a note, a link or the endpoint
  names reaches nothing.
- Never Orden's own config and data folders for a change, by their names or through a link.
- Never the spaces for a change: there the file list's own operations keep links, Recently
  deleted, versions and sync right.
- Never the top of a disk, the system's first folders, the home folder, or a folder that
  holds one of them.
- On Windows, no stream and no 8.3 alias.

## Drag and drop

- **Rows** drag as the picked rows, or the one row grabbed. Holding a drag over a folder
  row for a moment opens it.
- **Within and between explorers**, in a split or another window: a drop on a folder row,
  a crumb, a place or the room under the rows moves there; Ctrl (Alt on a Mac) copies.
  Out of a space it copies, and Shift moves.
- **Into a note, the tab strip or a pane**: rows that are all in a space carry the file
  list's own drag as well (`carryFromExplorer` in `drag-paths.ts`), so a note links them,
  a pane opens them and the file list moves them. Anything else carries its path as text.
- **Onto the file list**: rows from outside the spaces are copied in, as files dropped from
  another app are (`dropOnList` in `list-landing.svelte.ts`).
- **From another app**: files and folders dropped on an explorer are written into the
  folder (`explorer_write`), each under a free name, and one undo takes them away again;
  into a space they come in as the file list's import.
- **Onto Places**: a folder dropped between the places is pinned there. A pinned folder's
  menu unpins it, and a folder's own row menu has Pin to Places. Pins are this device's.
- **To other apps**: not possible. On Linux `page_drag.rs` keeps every drag inside the
  window, and the other engines give a page no way to start a drag of files. Copy path is
  the way out.

## Changes

`explorer/changes.ts` decides how each change is made:

- **Outside the spaces**, through the crate (`explorer/changes.rs` and `explorer/jobs.rs`).
  Each change is recorded on the app's one file-undo stack as an `outside` action, which
  `explorer/undo.ts` takes back and does again. So `Ctrl+Z` in an explorer, the toast's
  Undo and the file list's own undo are one history.
- **Inside a space**, through the file list's own operations (`workspace.rename`,
  `removeMany`, `copyMany`, `moveMany`, `bringIn`), which keep links, Recently deleted,
  versions and sync right and record their own undo. A new folder there is the
  `create_folder` command, as an agent's is.
- **Between the two.** A copy into a space is an import, the way a file dropped on the file
  list is: its bytes are read through the window, at most 48 MB a file. A copy out of a
  space is a copy. A move either way is that copy, with the original deleted afterwards in
  its own way (Recently deleted, or the system's trash). One gesture is one undo, however
  many of these it took.

Every change outside the spaces can be undone except Delete for good, which asks first. A
trash comes back out of the system's trash (`explorer/bin.rs`: the Mac's `NSFileManager`,
which says where it put the file, and the `trash` crate's Recycle Bin and freedesktop.org
trash, found again by where each came from and when). A copy is undone into the trash, not
deleted. A move or a rename goes back exactly where it was (`explorer_put`). A new folder
goes to the trash.

A copy or a move runs in the crate as a job (`explorer/jobs.svelte.ts`). It shows at the
foot with its progress and a Cancel once it has run for 400 ms. A cancelled copy stops
between two chunks of a file and takes away the half it wrote. A move on one disk is a
rename; across disks it is a copy, and the original goes only once the copy is whole.
Names already in the folder are asked about once, before anything is written: Keep both
(`name 2`), Replace or Skip. What Replace replaces goes to the trash first, so it can be
undone too. A folder never goes inside itself.

A folder in Orden's own folders, the folder of the spaces and its trash are shown and
offer no change.

## Agents

`explorer_tabs` (docs/agent-native.md 8.19) lists the explorer tabs, opens a folder in a new
tab behind the one in front, goes, picks, and trashes, moves, copies, renames and makes
folders through a tab, under the `files` scope and its questions. Every change it makes is
on the reader's undo stack. It never reaches Orden's own folders and changes nothing in the
spaces, where the note tools are.

