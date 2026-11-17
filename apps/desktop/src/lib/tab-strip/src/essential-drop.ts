import { insideSpace } from '../../platform/src/api'
import { essentials, workspace } from '../../workspace/src/api'

export async function droppedEssential(
  index: number,
  paneId: string,
  at: number,
): Promise<string | null> {
  const mark = workspace.bookmarks.list[index]
  const root = workspace.activeSpace?.root
  if (mark?.kind !== 'note' || !root) return null

  const { keepAsTab } = await essentials()
  const id = await keepAsTab(insideSpace(root, mark.path))
  if (id !== null) workspace.moveTab(id, paneId, at)
  return id
}
