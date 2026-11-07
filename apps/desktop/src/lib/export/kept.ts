import { appliedEdits } from '@orden/markdown/edits'
import { frontMatterEdits } from '@orden/markdown/front-matter'
import type { ItemMeta } from '@orden/sync-core/meta'
import { withOwnKeys } from '../own-keys'

export async function keptText(
  text: string,
  meta: ItemMeta | null,
  listed: boolean,
): Promise<string> {
  const owned = withOwnKeys(text, meta)
  const { LIST_KEY, LIST_VALUE, STOPPED_VALUE, writtenDates } =
    await import('@orden/bases/todo-lists')
  const said = listed ? LIST_VALUE : meta?.[LIST_KEY] === STOPPED_VALUE ? STOPPED_VALUE : null
  if (said === null) return owned
  const dated = listed ? writtenDates(owned, meta) : owned
  const edit = frontMatterEdits(dated, [[LIST_KEY, said]])
  return edit ? appliedEdits(dated, [edit]) : dated
}
