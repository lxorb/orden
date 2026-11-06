import { type Base, type Filter, placeOfKey, readBase, type View, writeBase } from '@orden/bases'
import { isRecord } from '../stored'
import { followSpaceViews, forgetSpaceViews, spaceRenamed, unnarrowed } from './kept-views'
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

function narrowedTo(view: View, from: string, to: string): View {
  const only = view.nib.kept.only
  if (!isRecord(only)) return view
  const project = typeof only.project === 'string' ? placeOfKey(only.project) : null
  const inSpace = project?.space === from
  if (only.space !== from && !inSpace) return view
  const next = {
    ...only,
    ...(only.space === from ? { space: to } : {}),
    ...(inSpace ? { project: `${to}//${project.path}` } : {}),
  }
  return { ...view, nib: { ...view.nib, kept: { ...view.nib.kept, only: next } } }
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
    views: base.views.map((one) =>
      narrowedTo(
        {
          ...one,
          ...(one.filters ? { filters: refiltered(one.filters, from, to) } : {}),
        },
        from,
        to,
      ),
    ),
  })
}

function unscopedFilter(filter: Filter, space: string): Filter | null {
  if (typeof filter === 'string') return filter === namesSpace(space) ? null : filter
  if (!('and' in filter)) return filter
  const rest = filter.and.flatMap((one) => {
    const kept = unscopedFilter(one, space)
    return kept === null ? [] : [kept]
  })
  if (rest.length > 1) return { and: rest }
  return rest[0] ?? null
}

export function unscoped(words: string, space: string): string {
  let base: Base
  try {
    base = readBase(words)
  } catch {
    return words
  }
  return writeBase({
    ...base,
    views: base.views.map((one) => {
      const filters = one.filters === undefined ? null : unscopedFilter(one.filters, space)
      const next: View = { ...one }
      if (filters === null) delete next.filters
      else next.filters = filters
      return next
    }),
  })
}

export function followSpaceTabs(from: string, to: string, tabs: readonly ViewHolder[]): void {
  for (const tab of tabs) {
    if (tab.kind !== 'view' || tab.path !== null) continue
    const spec = readSpec(tab.doc)
    if (spec?.space === undefined && spec?.yaml !== undefined) {
      const yaml = followed(spec.yaml, from, to)
      if (yaml !== spec.yaml) tab.note.replace(writeSpec({ ...spec, yaml }), false)
      continue
    }
    if (spec?.space !== from) continue
    const yaml = spec.yaml === undefined ? {} : { yaml: followed(spec.yaml, from, to) }
    tab.note.replace(writeSpec({ ...spec, space: to, ...yaml }), false)
  }
}

export function forgetSpaceTabs(space: string, tabs: readonly ViewHolder[]): void {
  for (const tab of tabs) {
    if (tab.kind !== 'view' || tab.path !== null) continue
    const spec = readSpec(tab.doc)
    if (spec?.space !== undefined || spec?.yaml === undefined) continue
    const yaml = unnarrowed(spec.yaml, space)
    if (yaml !== spec.yaml) tab.note.replace(writeSpec({ ...spec, yaml }), false)
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
