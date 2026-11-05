import { type Base, type Filter, readBase, writeBase } from '@orden/bases'
import { followSpaceViews, forgetSpaceViews, spaceRenamed } from './kept-views'
import { readSpec, writeSpec } from './spec'

interface ViewHolder {
  kind: string
  path: string | null
  doc: string
  note: { replace(words: string, undoable: boolean): void }
}

const namesSpace = (space: string) => `file.space == ${JSON.stringify(space)}`

function refiltered(filter: Filter, from: string, to: string): Filter {
  if (typeof filter === 'string') return filter.split(namesSpace(from)).join(namesSpace(to))
  if ('and' in filter) return { and: filter.and.map((one) => refiltered(one, from, to)) }
  if ('or' in filter) return { or: filter.or.map((one) => refiltered(one, from, to)) }
  return { not: filter.not.map((one) => refiltered(one, from, to)) }
}

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

export function followSpaceTabs(from: string, to: string, tabs: readonly ViewHolder[]): void {
  for (const tab of tabs) {
    if (tab.kind !== 'view' || tab.path !== null) continue
    const spec = readSpec(tab.doc)
    if (spec?.space !== from) continue
    const yaml = spec.yaml === undefined ? {} : { yaml: followed(spec.yaml, from, to) }
    tab.note.replace(writeSpec({ ...spec, space: to, ...yaml }), false)
  }
}

export function followSpaceName(
  from: string,
  to: string,
  tabs: readonly ViewHolder[],
  others: readonly { name: string }[],
): void {
  if (from === to || others.some((one) => one.name === from)) return
  followSpaceTabs(from, to, tabs)
  if (others.some((one) => one.name === to)) return
  forgetSpaceViews(to)
  followSpaceViews(from, to, (words) => followed(words, from, to))
  spaceRenamed(from, to)
}
