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

The commands that change things are in the crate already: `explorer/changes.rs` makes,
renames, trashes, brings back out of the trash and deletes for good, and `explorer/jobs.rs`
copies and moves with progress and a Cancel, counts a folder and searches below one. The
system's own trash, and the way back out of it for an undo, is `explorer/bin.rs`: the Mac's
`NSFileManager`, and the `trash` crate's Recycle Bin and freedesktop.org trash.
