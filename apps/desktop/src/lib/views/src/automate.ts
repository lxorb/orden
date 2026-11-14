import {
  type Base,
  type Context,
  fired,
  type Filling,
  idNumber,
  idRepairs,
  inBase,
  nextId,
  rowsInBase,
  readAutomations,
  type Row,
  type Value,
} from '@orden/bases'
import type { RowChange } from '../../rows/write'

export interface HeldBase {
  name: string
  space: string
  base: Base
}

export interface Planned {
  writes: { row: Row; change: RowChange }[]
  moves: { row: Row; folder: string }[]
  notices: { row: Row; base: string; words: string }[]
}

const EMPTY: Planned = { writes: [], moves: [], notices: [] }

function ownRows(base: Base, all: readonly Row[], context: Context) {
  return rowsInBase(
    base,
    all.filter((row) => row.kind === 'note'),
    context,
  )
}

export function planned(
  bases: readonly HeldBase[],
  removed: readonly Row[],
  added: readonly Row[],
  all: readonly Row[],
  context: Context,
  filling: Omit<Filling, 'title'>,
): Planned {
  const after = added.find((row) => row.kind === 'note')
  if (!after) return EMPTY
  const before = removed.find((row) => row.kind === 'note')

  const sets = new Map<Row, Record<string, Value | null>>()
  const set = (row: Row, values: Record<string, Value | null>) =>
    sets.set(row, { ...sets.get(row), ...values })
  const out: Planned = { writes: [], moves: [], notices: [] }

  for (const held of bases) {
    if (held.space !== after.space || !inBase(held.base, after, context)) continue
    const moved =
      before !== undefined && (before.path !== after.path || before.space !== after.space)
    const was =
      moved && !(before.space === held.space && inBase(held.base, before, context))
        ? undefined
        : before

    const effect = fired(readAutomations(held.base), was, after, filling)
    if (effect) {
      if (Object.keys(effect.set).length) set(after, effect.set)
      if (effect.move !== undefined) out.moves.push({ row: after, folder: effect.move })
      for (const words of effect.notify) out.notices.push({ row: after, base: held.name, words })
    }

    const id = held.base.orden.id
    if (!id) continue
    const { rows: own, partial } = ownRows(held.base, all, context)
    if (partial) continue
    if (was === undefined && idNumber(after.note[id.property], id.prefix) === null) {
      set(after, { [id.property]: nextId(own, id.property, id.prefix) })
    }
    for (const { row, id: next } of idRepairs(own, id.property, id.prefix, false)) {
      set(row, { [id.property]: next })
    }
  }

  out.writes = [...sets].map(([row, note]) => ({ row, change: { note } }))
  return out
}
