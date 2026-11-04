/** An essential's tile, or a note's row of the bookmarks, let go of on a strip of tabs
 *  (#1051): kept as a tab, as a double click keeps it - the essential's own tab, its
 *  place in the note and its page as they are - and put where it was let go of. Arc's and
 *  Zen's Favorite dragged down into the tabs.
 *
 *  Fetched with the first such drop; see Tabs.svelte. */

import { keepAsTab } from '../essentials.svelte'
import { insideSpace } from '../space-paths'
import { workspace } from '../workspace.svelte'

/** The bookmark at `index` of the open space, kept as a tab of `paneId` at `at` in its
 *  strip. A bookmark that is no note - a folder, a block - is not a tab, and nothing
 *  happens. Answers the tab, or null. */
export async function droppedEssential(
  index: number,
  paneId: string,
  at: number,
): Promise<string | null> {
  const mark = workspace.bookmarks.list[index]
  const root = workspace.activeSpace?.root
  if (mark?.kind !== 'note' || !root) return null

  // A bookmark names its file inside the space, as the list's own rows read it.
  const id = await keepAsTab(insideSpace(root, mark.path))
  if (id !== null) workspace.moveTab(id, paneId, at)
  return id
}
