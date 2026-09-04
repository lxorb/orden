# Recently deleted, and selecting several things at once

Two related pieces: a place deleted notes and spaces wait for 14 days before
they are gone, and a way to pick several rows in the tree so they can be moved
or deleted together. Deleting several things at once is what makes the first
worth having.

## Recently deleted

"Recently deleted" (de: "Zuletzt gelöscht") is the name in the interface. It
says what it holds and that the holding is temporary.

### Signed in: the account keeps it

Deleting is a flag, not a removal. The server already marks notes and spaces
`deleted = 1` so other devices learn about it; what changes is that the
content stays and a `deleted_at` timestamp is recorded (migration `0011`).

- `DELETE /v1/notes/:id` keeps the R2 object; sets `deleted = 1`, `deleted_at`,
  bumps `seq` and `version`. `size` and `hash` stay, so restoring needs no
  upload.
- `DELETE /v1/spaces/:id` keeps its notes and their objects; sets the flag and
  the timestamp; releases the blog address as today (a restored space comes
  back unpublished - its name may be taken by then).
- `GET /v1/trash` lists what the account holds: deleted spaces (name, when,
  how many notes), and deleted notes of live spaces (path, space, when). Each
  carries `purgeAt = deletedAt + 14 days`. Notes of a deleted space are not
  listed on their own; they return with the space.
- `POST /v1/trash/spaces/:id/restore`: `deleted = 0`, `deleted_at = null`,
  appended to the space order. A live space with the same name makes the
  restored one `Name 2`, `Name 3`... - the numbering the app already uses.
- `POST /v1/trash/notes/:id/restore`: refused with 409 while its space is
  deleted (restore the space). A live note at the same path makes the restored
  one `Name 2.md` in the same folder. Flag cleared, `seq` and `version` bumped,
  so every device pulls it back through the existing change feed.
- `DELETE /v1/trash/notes/:id`, `DELETE /v1/trash/spaces/:id`: purge one now.
  `DELETE /v1/trash`: purge everything of the account.
- Purge, by a daily cron trigger (`0 3 * * *`) or on request: a note's R2
  object is deleted and the row reduced to the tombstone sync relies on
  (`size = 0`, `hash = ''`, `deleted_at = null`); a space's notes and objects
  are removed and the row stays as the marker, `deleted_at = null`. Nothing
  with `deleted_at` older than 14 days survives a run.
- A purged item is one with `deleted = 1` and `deleted_at = null`; the listing
  shows only `deleted_at is not null`.

Sync needs no new protocol: a tombstone still removes the local file on every
device, and a restore looks like a note that changed.

### Signed out: the device keeps it

Notes and spaces live under `Documents/Nib`. Deleting moves the file or folder
into `Documents/Nib/.trash/<id>` and appends to `.trash/manifest.json`:
`{ id, kind: 'note' | 'folder' | 'space', name, from (path relative to Nib),
trashedAt }`. `list_spaces` skips `.trash`. Restore moves it back to `from`,
with the same numbering when the place is taken. Purge deletes the entry and
its files; it runs at startup and once a day while the app is open, and on
request. The browser build keeps the same records in its in-memory store.

Signed in, a deletion removes the local copy as today and the account holds
the content. Items already in the device trash stay listed, marked "on this
device", until they age out or are restored.

### Settings section

A new section "Recently deleted" in the settings list. Two groups, Spaces and
Notes; each row shows the name, where it was, "deleted 3 days ago · gone in
11 days", a Restore button and a Delete now button. An Empty button at the top
asks once. Restoring a space brings its notes with it. The section reads from
the account when signed in and from the device otherwise, merging leftover
device items in.

The in-memory "Undo deleting" stays as the instant path.

## Selecting several rows

The tree keeps a selection: a set of paths and an anchor, in the workspace
store, cleared when the space changes.

- Plain click: selects that row alone and opens the note as today.
- Ctrl-click (Cmd on a Mac): toggles the row in the selection, opens nothing.
- Shift-click: selects the rows from the anchor to the clicked row, in the
  order they are shown (folders' children only when the folder is open).
- Ctrl+A with the tree focused selects every shown row; Escape clears.
- Delete or Backspace with the tree focused deletes the selection: to Recently
  deleted, so no confirmation is needed.
- Dragging a selected row drags the whole selection (`text/nib-paths`, a JSON
  array); dropping on a folder, the root, or a space moves every item. A row
  outside the selection drags alone as today.
- The context menu on a selected row acts on the selection for Move to space
  and Delete; Rename and the single-note actions appear only for one row.

Selected rows carry `.selected`; the active note keeps its own look.

## Tests

- Server: content survives a delete; listing; restore of a note and of a space,
  with and without a name clash; refusing a note whose space is deleted; purge
  touches only items past 14 days and keeps tombstones; manual purge and empty;
  only the owner's items.
- Desktop stores: the device trash (move, list, restore with numbering, purge
  by age) against the mocked platform; the selection model (toggle, range,
  select all, clear, what a drag carries); the settings section's data.
