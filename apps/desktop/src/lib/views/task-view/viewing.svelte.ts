/** Which task's view is up (docs/tasks.md, the Todoist round): a row pressed in a list,
 *  a board's card, a calendar's event, a sub-task inside another task's view. It
 *  remembers the task by where it is written rather than by the row object, which the
 *  rows store replaces on every write, and the list it was opened from, for the arrows
 *  that walk to the task above and below.
 *
 *  Put on the page the first time it is asked for (people/card.svelte.ts's way), so
 *  nothing of it is fetched before somebody opens a task. */

import { type Row, taskHash } from '@nib/bases'
import { mount } from 'svelte'
import { samePath } from '../../space-paths'
import type { Kit } from '../kit'

/** A task as the view finds it again: its note, its line and the hash of its words. */
export interface TaskRef {
  space: string
  path: string
  line: number
  hash: string
}

export interface Shown {
  ref: TaskRef
  /** The tasks of the list it was opened from, in its order. */
  list: readonly TaskRef[]
  kit: Kit
  /** Opened to write a comment (`c`): its field has the keyboard. */
  comment?: boolean
}

export function refOf(row: Row): TaskRef | null {
  return row.anchor && row.task
    ? { space: row.space, path: row.path, line: row.anchor.line, hash: row.anchor.hash }
    : null
}

const sameRef = (a: TaskRef, b: TaskRef) =>
  a.space === b.space && samePath(a.path, b.path) && a.hash === b.hash

/** The row a ref names among the rows as they are now: the same words nearest the line
 *  it was on, else whatever task is on that line now (a recurring task ticked leaves its
 *  next occurrence where it stood). Null where the note holds neither. */
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

  /** The task above or below in the list it was opened from. */
  step(by: -1 | 1): void {
    const shown = this.shown
    if (!shown) return
    const at = shown.list.findIndex((one) => sameRef(one, shown.ref))
    const next = shown.list[at + by]
    if (at === -1 || !next) return
    this.shown = { ...shown, ref: next }
  }

  /** Whether there is a task above, or below. */
  can(by: -1 | 1): boolean {
    const shown = this.shown
    if (!shown) return false
    const at = shown.list.findIndex((one) => sameRef(one, shown.ref))
    return at !== -1 && shown.list[at + by] !== undefined
  }

  /** The task's own words changed here: the view follows them to their new hash. */
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

  /** Another task, inside this one's view: a sub-task, or its parent. */
  open(row: Row): void {
    const shown = this.shown
    const ref = refOf(row)
    if (!shown || !ref) return
    this.shown = { ...shown, ref }
  }
}

export const viewing = new Viewing()

let mounted = false

/** Opens a task's view, with the list it was pressed in for the arrows. */
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
