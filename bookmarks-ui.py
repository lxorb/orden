"""Groups and block bookmarks, as the list draws them."""

import pathlib

path = pathlib.Path("apps/desktop/src/lib/Bookmarks.svelte")
text = path.read_text(encoding="utf-8")

PAIRS = [
    # The row gains a depth and knows a group when it sees one.
    (
        """  interface Row {
    mark: Bookmark
    /** Where it sits in the list, which is what a drag moves. */
    at: number
    label: string""",
        """  interface Row {
    mark: Bookmark
    /** Where it sits in the list, which is what a drag moves. */
    at: number
    /** How many groups deep, which is how far the row steps in. */
    depth: number
    label: string""",
    ),
    # The walk: the list is flat and the groups are drawn out of it.
    (
        """  const rows = $derived.by((): Row[] => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []

    const out: Row[] = []

    for (const [at, mark] of workspace.bookmarks.list.entries()) {
      if (mark.kind === 'search') {
        out.push({ mark, at, label: mark.text, note: null, path: null, kind: null, active: false })
        continue
      }

      const entry = byPath.get(insideSpace(root, mark.path))
      if (!entry) continue

      const open = !entry.is_dir && workspace.active?.path === entry.path
      out.push({
        mark,
        at,
        label: mark.kind === 'heading' ? mark.text : shownName(entry.name),
        note: mark.kind === 'heading' ? shownName(entry.name) : null,
        path: entry.path,
        kind: entry.is_dir ? 'folder' : fileMark(entry.name),
        active: open,
      })
    }

    return out
  })""",
        """  /** One bookmark as a row, or nothing where there is nothing left to point at:
   *  a note that has gone from the space simply has no row. */
  function rowFor(mark: Bookmark, at: number, depth: number, root: string): Row | null {
    const shared = { mark, at, depth }

    if (mark.kind === 'group') {
      return { ...shared, label: mark.text, note: null, path: null, kind: null, active: false }
    }
    if (mark.kind === 'search') {
      return { ...shared, label: mark.text, note: null, path: null, kind: null, active: false }
    }

    // A block bookmark carries the whole of what a link into it would say, so the
    // note is the part in front of the `#`; see forBlock in bookmarks.svelte.ts.
    const inside = mark.kind === 'block' ? mark.path.split('#')[0] ?? '' : mark.path
    const entry = byPath.get(insideSpace(root, inside))
    if (!entry) return null

    const named = mark.kind === 'heading' || mark.kind === 'block'
    return {
      ...shared,
      label: named ? mark.text : shownName(entry.name),
      note: named ? shownName(entry.name) : null,
      path: entry.path,
      kind: entry.is_dir ? 'folder' : fileMark(entry.name),
      active: !entry.is_dir && workspace.active?.path === entry.path,
    }
  }

  /** The list as it is drawn: the top of it in the order it is kept, and under
   *  every open group the rows that say they are in it. One walk over a flat
   *  list rather than a tree of lists, because the order of the list is the
   *  order of the list; see bookmarks.svelte.ts. */
  const rows = $derived.by((): Row[] => {
    const root = workspace.activeSpace?.root
    if (root === undefined) return []

    const list = workspace.bookmarks.list
    const out: Row[] = []

    const walk = (parent: string | undefined, depth: number) => {
      for (const [at, mark] of list.entries()) {
        if ((mark.parent ?? undefined) !== parent) continue

        const row = rowFor(mark, at, depth, root)
        if (!row) continue

        out.push(row)
        if (mark.kind === 'group' && workspace.isGroupOpen(mark.path)) walk(mark.path, depth + 1)
      }
    }

    walk(undefined, 0)
    return out
  })""",
    ),
    # Opening: a group opens itself, a block opens its note at the block.
    (
        """      case 'heading':
        void workspace.openAtHeading(mark.path, mark.text)
        break""",
        """      case 'heading':
        void workspace.openAtHeading(mark.path, mark.text)
        break
      case 'block':
        void workspace.openAtBlock(mark.path)
        break
      case 'group':
        workspace.toggleGroup(mark.path)
        break""",
    ),
    # Dropping onto a group puts the row in it.
    (
        """  function drop(event: DragEvent, row: Row) {
    event.preventDefault()
    const from = draggedBookmark(event.dataTransfer)
    endDrag()
    if (from !== null) workspace.bookmarks.move(from, row.at)
  }""",
        """  function drop(event: DragEvent, row: Row) {
    event.preventDefault()
    const from = draggedBookmark(event.dataTransfer)
    endDrag()
    if (from === null) return

    const moving = workspace.bookmarks.list[from]
    if (!moving) return

    // Onto a group is into it; anywhere else is beside the row it landed on, in
    // whatever that row is in - so a row dropped between two rows of a group
    // joins the group, which is what the line drawn there said it would do.
    if (row.mark.kind === 'group' && !sameBookmark(moving, row.mark)) {
      workspace.bookmarks.moveInto(moving, row.mark.path)
      workspace.openGroup(row.mark.path)
      return
    }

    workspace.bookmarks.moveInto(moving, row.mark.parent ?? null)
    workspace.bookmarks.move(from, row.at)
  }""",
    ),
]

for old, new in PAIRS:
    assert old in text, old[:70]
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8", newline="\n")
print("Bookmarks.svelte ok")
