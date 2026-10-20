/** What every layout of a view can do, in one place: open a row's note at its line,
 *  tick a task, write a cell, drop a row into a group, add to a group, and change the
 *  view itself. A layout draws the engine's answer and calls these; it never filters,
 *  sorts or writes a file of its own (docs/tasks.md 5.9). */

import { type Base, BUTTON, groupName, type Row, type Value } from '@nib/bases'
import type { RowChange } from '../rows/write'
import { insideSpace } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { dropRow, tickRow, writeRow } from './act'
import { addNote, openQuickAdd, type Prefill, prefillOf } from './add'
import { dropInto } from './drop'
import { pressButton } from './press'
import type { LiveView } from './live.svelte'
import type { ViewSpec } from './spec'
import { layoutOf } from './words'

export interface Kit {
  live: LiveView
  spec: ViewSpec
  /** The base file the view is of, on this disk, or null. */
  file: string | null
  /** A fence or an embed: a smaller head, and no layouts that need a tab's room. */
  compact: boolean
  /** Opens the row's note at its line: beside the view, or in a tab of its own. */
  open(row: Row, how?: 'aside' | 'tab'): void
  /** Opens a task's view, with the view's own rows for its arrows; `comment` gives its
   *  comment field the keyboard. */
  openTask(row: Row, comment?: boolean): void
  /** What a press on a row opens: a task's view, a note beside the view; with `tab`
   *  (Ctrl or Cmd held), the note in a tab of its own either way. */
  choose(row: Row, tab?: boolean): void
  tick(row: Row): void
  write(row: Row, change: RowChange): void
  /** A button cell pressed: `column` is `button.<name>`. */
  press(row: Row, column: string): void
  /** A row dropped into the group keyed `key` of the view's grouping (or of
   *  `property` where a layout groups by one of its own, a calendar's day). */
  drop(row: Row, key: Value, property?: string): void
  /** Adds to the view, in a group where one is named; a note of a view of notes from
   *  `template` where one is named (null for a blank one). Answers the prefill where the
   *  view's own add row should take the words (no quick add yet), else null. */
  add(group?: { property: string; key: Value }, template?: string | null): Prefill | null
  /** Changes the view: a new base made from the one showing. A locked view or base
   *  turns the change away and its lock answers (`live.refused`), unless `unlocking`:
   *  the lock's own switch. */
  change(edit: (base: Base, at: number) => Base, unlocking?: boolean): void
  /** The change, kept: answers once it is written, false where a lock turned it away.
   *  `show` is the view to move to with the change, as it is made. */
  changed(edit: (base: Base, at: number) => Base, show?: number): Promise<boolean>
}

/** Where a row's note is on this disk. */
export function notePath(row: Row): string | null {
  const space = workspace.spaces.find((one) => one.name === row.space)
  return space ? insideSpace(space.root, row.path) : null
}

/** The view's notes in the order it shows them, once each: what a peek steps through.
 *  A board or a list leaves out the groups it hides, as the reader does. */
function walkOf(live: LiveView): string[] {
  const seen = new Set<string>()
  const layout = layoutOf(live.view?.type ?? 'table')
  const hidden = layout === 'kanban' || layout === 'list' ? (live.view?.nib.hidden ?? []) : []
  for (const group of live.answer?.groups ?? []) {
    if (hidden.includes(groupName(group.key))) continue
    for (const row of group.rows) {
      const path = row.task ? null : notePath(row)
      if (path !== null) seen.add(path)
    }
  }
  return [...seen]
}

export function kitFor(live: LiveView, spec: ViewSpec, file: string | null, compact: boolean): Kit {
  const kit: Kit = {
    live,
    spec,
    file,
    compact,
    open(row, how = 'aside') {
      const path = notePath(row)
      if (path === null) return
      const line = row.anchor?.line ?? 0
      const opening =
        how === 'aside'
          ? import('./peek').then((one) => one.peek(path, walkOf(live)))
          : workspace.open(path)
      void opening.then(() => {
        workspace.goto = { path, line }
      })
    },
    openTask(row, comment = false) {
      const list = (live.answer?.groups ?? []).flatMap((group) => group.rows)
      void import('./task-view/viewing.svelte').then((one) => one.showTask(row, kit, list, comment))
    },
    choose(row, tab = false) {
      if (row.task && !tab) kit.openTask(row)
      else kit.open(row, tab ? 'tab' : 'aside')
    },
    tick(row) {
      void tickRow(row, live.today)
    },
    write(row, change) {
      void writeRow(row, change)
    },
    press(row, column) {
      if (live.base) void pressButton(live.base, column.slice(BUTTON.length), row)
    },
    drop(row, key, property) {
      const by = property ?? live.view?.groupBy?.property
      if (by === undefined) return
      const drop = dropInto(by, key, row, live.today)
      if (drop) void dropRow(row, drop)
    },
    add(group, template) {
      const base = live.base
      const kinds = live.view?.nib.rows ?? 'notes'
      if (base && kinds === 'notes') {
        void addNote(base, live.at, file, group, template === undefined ? {} : { template })
        return null
      }
      const prefill = prefillOf(spec, live.today, group)
      return openQuickAdd(prefill) ? null : prefill
    },
    change(edit, unlocking = false) {
      const base = live.base
      if (!base) return
      if (live.locked && !unlocking) {
        live.refused++
        return
      }
      void live.change(edit(base, live.at))
    },
    async changed(edit, show) {
      const base = live.base
      if (!base) return false
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
