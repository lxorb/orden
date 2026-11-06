import { keepAsTab } from '../essentials.svelte'
import { insideSpace } from '../space-paths'
import { workspace } from '../workspace.svelte'

export async function droppedEssential(
  index: number,
  paneId: string,
  at: number,
): Promise<string | null> {
  const mark = workspace.bookmarks.list[index]
  const root = workspace.activeSpace?.root
  if (mark?.kind !== 'note' || !root) return null

  const id = await keepAsTab(insideSpace(root, mark.path))
  if (id !== null) workspace.moveTab(id, paneId, at)
  return id
}
