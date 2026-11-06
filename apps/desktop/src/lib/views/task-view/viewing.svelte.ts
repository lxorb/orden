import { type Row, taskHash } from '@orden/bases'
import { mount } from 'svelte'
import { samePath } from '../../space-paths'
import type { Kit } from '../kit'

export interface TaskRef {
  space: string
  path: string
  line: number
  hash: string
}

export interface Shown {
  ref: TaskRef
  list: readonly TaskRef[]
  kit: Kit
  comment?: boolean
}

export function refOf(row: Row): TaskRef | null {
  return row.anchor && row.task
    ? { space: row.space, path: row.path, line: row.anchor.line, hash: row.anchor.hash }
    : null
}

const sameRef = (a: TaskRef, b: TaskRef) =>
  a.space === b.space && samePath(a.path, b.path) && a.hash === b.hash

export function rowFor(ref: TaskRef, rows: readonly Row[]): Row | null {
  let best: Row | null = null
  let distance = Infinity
  let onLine: Row | null = null
  for (const row of rows) {
    if (!row.task || !row.anchor || row.space !== ref.space || !samePath(row.path, ref.path)) {
      continue
    }
    if (row.anchor.line === ref.line) onLine = row
    if (row.anchor.hash !== ref.hash) continue
    const away = Math.abs(row.anchor.line - ref.line)
    if (away < distance) {
      best = row
      distance = away
    }
  }
  return best ?? onLine
}

class Viewing {
  shown = $state.raw<Shown | null>(null)

  close(): void {
    this.shown = null
  }

  step(by: -1 | 1): void {
    const shown = this.shown
    if (!shown) return
    const at = shown.list.findIndex((one) => sameRef(one, shown.ref))
    const next = shown.list[at + by]
    if (at === -1 || !next) return
    this.shown = { ...shown, ref: next }
  }

  can(by: -1 | 1): boolean {
    const shown = this.shown
    if (!shown) return false
    const at = shown.list.findIndex((one) => sameRef(one, shown.ref))
    return at !== -1 && shown.list[at + by] !== undefined
  }

  renamed(words: string, line: number): void {
    const shown = this.shown
    if (!shown) return
    const was = shown.ref
    const ref = { ...was, line, hash: taskHash(words) }
    this.shown = {
      ...shown,
      ref,
      list: shown.list.map((one) => (sameRef(one, was) ? ref : one)),
    }
  }

  open(row: Row): void {
    const shown = this.shown
    const ref = refOf(row)
    if (!shown || !ref) return
    this.shown = { ...shown, ref }
  }
}

export const viewing = new Viewing()

let mounted = false

export function showTask(row: Row, kit: Kit, list: readonly Row[], comment = false): void {
  const ref = refOf(row)
  if (!ref) return
  viewing.shown = {
    ref,
    list: list.flatMap((one) => {
      const made = refOf(one)
      return made ? [made] : []
    }),
    kit,
    ...(comment ? { comment } : {}),
  }
  if (mounted) return
  mounted = true
  void import('./TaskView.svelte').then((one) => mount(one.default, { target: document.body }))
}
