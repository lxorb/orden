/** A space renamed: a view of it asks about it by its name (`file.space == "Work"`, spec.ts),
 *  and so does what this device keeps for it (kept-views.ts), so every tab showing one and
 *  everything kept comes along, rather than an empty list about a space that is gone.
 *
 *  Told by `renameSpace` whether any view has been drawn yet or not, and asked again by a
 *  tab read later (`source.ts`): a tab put aside with another space, or one a rename left
 *  behind before this was here. */

import { type Base, type Filter, readBase, writeBase } from '@orden/bases'
import { followSpaceViews } from './kept-views'
import { readSpec, writeSpec } from './spec'

/** The tab, as much of it as a view keeps its words in. */
interface ViewHolder {
  kind: string
  path: string | null
  doc: string
  note: { replace(words: string, undoable: boolean): void }
}

const namesSpace = (space: string) => `file.space == ${JSON.stringify(space)}`

/** A filter asking about `to` where it asked about `from`, at any depth. */
function refiltered(filter: Filter, from: string, to: string): Filter {
  if (typeof filter === 'string') return filter.split(namesSpace(from)).join(namesSpace(to))
  if ('and' in filter) return { and: filter.and.map((one) => refiltered(one, from, to)) }
  if ('or' in filter) return { or: filter.or.map((one) => refiltered(one, from, to)) }
  return { not: filter.not.map((one) => refiltered(one, from, to)) }
}

/** A built-in view's words about the space under its new name; words that do not read stay
 *  as they are, and whatever the reader changed stays. */
function followed(words: string, from: string, to: string): string {
  let base: Base
  try {
    base = readBase(words)
  } catch {
    return words
  }
  return writeBase({
    ...base,
    ...(base.filters ? { filters: refiltered(base.filters, from, to) } : {}),
    views: base.views.map((one) => ({
      ...one,
      ...(one.filters ? { filters: refiltered(one.filters, from, to) } : {}),
    })),
  })
}

/** Everything of a view about the space `from` made about `to`. A space of the old name
 *  still there (two can bear one, once one is somebody else's; `others`) keeps what is
 *  kept under it. */
export function followSpaceName(
  from: string,
  to: string,
  tabs: readonly ViewHolder[],
  others: readonly { name: string }[],
): void {
  if (from === to || others.some((one) => one.name === from)) return
  for (const tab of tabs) {
    if (tab.kind !== 'view' || tab.path !== null) continue
    const spec = readSpec(tab.doc)
    if (spec?.space !== from) continue
    const yaml = spec.yaml === undefined ? {} : { yaml: followed(spec.yaml, from, to) }
    tab.note.replace(writeSpec({ ...spec, space: to, ...yaml }), false)
  }
  followSpaceViews(from, to, (words) => followed(words, from, to))
}
