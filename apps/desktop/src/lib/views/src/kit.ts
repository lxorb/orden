import { type Base, BUTTON, groupName, type Row, type Value } from '@orden/bases'
import type { RowChange } from '../../rows/write'
import { canWriteAt } from '../../sharing/src/api'
import { insideSpace } from '../../platform/src/api'
import { workspace } from '../../workspace.svelte'
import { dropRow, writeRow } from './act'
import { addNote } from './add'
import { dropInto } from './drop'
import { pressButton } from './press'
import type { LiveView } from './live.svelte'
import type { ViewSpec } from './spec'
import { layoutOf } from './words'

export interface Kit {
  live: LiveView
  spec: ViewSpec
  file: string | null
  compact: boolean
  open(row: Row, how?: 'aside' | 'tab'): void
  choose(row: Row, tab?: boolean): void
  writes(row: Row): boolean
  readonly writable: boolean
  readonly adds: boolean
  write(row: Row, change: RowChange): void
  press(row: Row, column: string): void
  drop(row: Row, key: Value, property?: string, from?: Value): void
  add(group?: { property: string; key: Value }, template?: string | null): void
  change(edit: (base: Base, at: number) => Base, unlocking?: boolean): void
  changed(edit: (base: Base, at: number) => Base, show?: number): Promise<boolean>
}

export function notePath(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

function walkOf(live: LiveView): string[] {
  const seen = new Set<string>()
  const layout = layoutOf(live.view?.type ?? 'table')
  const hidden = layout === 'kanban' ? (live.view?.orden.hidden ?? []) : []
  for (const group of live.answer?.groups ?? []) {
    if (hidden.includes(groupName(group.key))) continue
    for (const row of group.rows) {
      const path = notePath(row)
      if (path !== null) seen.add(path)
    }
  }
  return [...seen]
}

export function kitFor(live: LiveView, spec: ViewSpec, file: string | null, compact: boolean): Kit {
  const writes = (row: Row) => {
    const path = notePath(row)
    return path === null || canWriteAt(path)
  }
  const reachable = () => {
    const at = live.writtenAt
    return at === null || canWriteAt(at)
  }
  const kit: Kit = {
    live,
    spec,
    file,
    compact,
    writes,
    get writable() {
      return !live.fixed && reachable()
    },
    get adds() {
      if (!reachable()) return false
      const to = file ?? workspace.activeSpace?.root
      return to === undefined || canWriteAt(to)
    },
    open(row, how = 'aside') {
      const path = notePath(row)
      if (path === null) return
      const line = row.anchor?.line ?? 0
      const away = compact ? workspace.spaces.find((one) => one.name === row.space) : undefined
      const there =
        away && away.id !== workspace.activeSpaceId
          ? workspace.selectSpace(away.id)
          : Promise.resolve()
      const opening = there.then(() =>
        how === 'aside'
          ? import('./peek').then((one) => one.peek(path, walkOf(live)))
          : workspace.open(path),
      )
      void opening.then(() => {
        workspace.goto = { path, line }
      })
    },
    choose(row, tab = false) {
      kit.open(row, tab ? 'tab' : 'aside')
    },
    write(row, change) {
      if (writes(row)) void writeRow(row, change)
    },
    press(row, column) {
      if (live.base && writes(row)) void pressButton(live.base, column.slice(BUTTON.length), row)
    },
    drop(row, key, property, from) {
      const by = property ?? live.view?.groupBy?.property
      if (by === undefined || !writes(row)) return
      const drop = dropInto(by, key, row, from ?? null)
      if (drop) void dropRow(row, drop)
    },
    add(group, template) {
      const base = live.base
      if (!base || !reachable()) return
      void addNote(base, live.at, file, group, template === undefined ? {} : { template })
    },
    change(edit, unlocking = false) {
      const base = live.base
      if (!base || !kit.writable) return
      if (live.locked && !unlocking) {
        live.refused++
        return
      }
      void live.change(edit(base, live.at))
    },
    async changed(edit, show) {
      const base = live.base
      if (!base || !kit.writable) return false
      if (live.locked) {
        live.refused++
        return false
      }
      await live.change(edit(base, live.at), show)
      return true
    },
  }
  return kit
}
