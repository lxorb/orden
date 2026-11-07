import { LIST_KEY, LIST_VALUE, STOPPED_VALUE } from '@orden/bases/todo-lists'
import { appliedEdits } from '@orden/markdown/edits'
import { frontMatterEdits, frontMatterValue } from '@orden/markdown/front-matter'
import type { MetaPatch } from '@orden/sync-core/meta'

export interface ListTaken {
  meta: MetaPatch
  text: string
}

export function listKeyTaken(text: string): ListTaken | null {
  const said = frontMatterValue(text, LIST_KEY)?.trim().toLowerCase()
  if (said !== LIST_VALUE && said !== STOPPED_VALUE) return null
  const edit = frontMatterEdits(text, [[LIST_KEY, null]])
  return { meta: { [LIST_KEY]: said }, text: edit ? appliedEdits(text, [edit]) : text }
}
