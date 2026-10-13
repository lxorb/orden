/** What can be done to a task from a view, in one place: schedule it (the scheduler,
 *  for one task or many as one write), its labels, its project, and its menu - complete,
 *  schedule, priority, move, duplicate, copy its link, open it in its note, delete. The
 *  row's ⋯, its context menu, the bulk bar and the keys (row-keys.ts) reach the same
 *  functions, for one task or every one selected, so a task is scheduled one way from
 *  everywhere.
 *
 *  Every write is the views' one write path (act.ts): one edit of each note it touches,
 *  one undo. */

import type { Priority, Row } from '@nib/bases'
import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { rows as store } from '../rows/rows.svelte'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import {
  deleteRows,
  duplicateRows,
  indentRow,
  linkToRow,
  moveRow,
  moveRowsTo,
  tickRows,
  writeEach,
} from './act'
import type { Kit } from './kit'
import { placeEntries } from './project-actions'
import type { RowKey } from './row-keys'
import { changeFor, loadByDay } from './schedule/schedule'
import { type Box, showScheduler } from './schedule/scheduling.svelte'
import { labelsOf } from './task-meta'

/** The scheduler, beside what asked, for these tasks: what it picks is written to every
 *  one of them as one write. It opens on the first task's day. */
export function scheduleRows(
  rows: readonly Row[],
  from: Element | Box,
  kit: Kit,
  closed?: () => void,
): void {
  const tasks = rows.filter((row) => row.task)
  const first = tasks[0]?.task
  if (!first) return
  showScheduler(from, {
    current: {
      due: first.due ?? first.scheduled,
      time: first.time,
      minutes: first.duration,
      recurrence: first.recurrence,
    },
    today: kit.live.today,
    load: loadByDay(kit.live.rows),
    pick: (picked) =>
      void writeEach(
        tasks.map((row) => ({ row, change: { task: changeFor(row.task ?? null, picked) } })),
        false,
        'scheduled',
      ),
    ...(closed ? { closed } : {}),
  })
}

/** The scheduler for a task's deadline: a day and nothing else, written as its
 *  `[deadline::]`, or taken away by No date. */
export function scheduleDeadline(row: Row, from: Element | Box, kit: Kit): void {
  const task = row.task
  if (!task) return
  showScheduler(from, {
    current: { due: task.deadline },
    today: kit.live.today,
    load: loadByDay(kit.live.rows),
    dateOnly: true,
    pick: (picked) => void writeEach([{ row, change: { task: { deadline: picked.due } } }]),
  })
}

/** Priority for these tasks, as one write. */
export function prioritise(rows: readonly Row[], priority: Priority): Promise<boolean> {
  return writeEach(
    rows.filter((row) => row.task).map((row) => ({ row, change: { task: { priority } } })),
  )
}

/** The rows of the priority choice, p1 to p4, the one in force ticked. */
export function priorityEntries(current: number, set: (priority: Priority) => void): MenuEntry[] {
  return ([1, 2, 3, 4] as const).map((level) => ({
    label: t('Priority {level}', { level }),
    checked: current === level,
    run: () => set(level),
  }))
}

/** The date taken off these tasks, its time and its repeat with it: Shift+T. */
function undate(rows: readonly Row[]): Promise<boolean> {
  const tasks = rows.filter((row) => row.task)
  return writeEach(
    tasks.map((row) => ({ row, change: { task: changeFor(row.task ?? null, { due: null }) } })),
    false,
    'scheduled',
  )
}

/** The labels these tasks can be given: every tag the space's tasks carry, ticked where
 *  every one of them has it. A press gives it to all of them, or takes it off all. */
export function labelEntries(rows: readonly Row[]): MenuEntry[] {
  const tasks = rows.filter((row) => row.task)
  const space = tasks[0]?.space
  return labelsOf(space === undefined ? [] : store.of(space)).map((tag) => {
    const all = tasks.every((row) => row.task?.tags.includes(tag))
    return {
      label: `#${tag}`,
      checked: all,
      run: () =>
        void writeEach(
          tasks.map((row) => {
            const own = row.task?.tags ?? []
            const tags = all
              ? own.filter((one) => one !== tag)
              : own.includes(tag)
                ? own
                : [...own, tag]
            return { row, change: { task: { tags } } }
          }),
        ),
    }
  })
}

/** Where these tasks can be moved: the Inbox and every project of the open space. The
 *  note they are all in now is ticked. */
export function moveEntries(rows: readonly Row[]): MenuEntry[] {
  const tasks = rows.filter((row) => row.task)
  const root = workspace.activeSpace?.root
  const name = workspace.activeSpace?.name
  return placeEntries(
    (path) => void moveRowsTo(tasks, path),
    (note) =>
      root !== undefined &&
      tasks.every((row) => row.space === name && samePath(insideSpace(root, row.path), note)),
  )
}

/** A row that opens rows of its own, worked out when it is opened. */
function more(label: string, entries: () => MenuEntry[]): MenuEntry {
  return { label, run: () => undefined, more: () => Promise.resolve(entries()) }
}

/** A task's own menu: from its ⋯, a press with the other button, or the `.` key. With
 *  many selected, theirs: what is done to all of them at once. `select` offers to select
 *  the row, the way into selecting on a touch screen. */
export function taskMenu(
  event: MouseEvent | Box,
  rows: readonly Row[],
  kit: Kit,
  select?: () => void,
): void {
  const tasks = rows.filter((row) => row.task)
  const first = tasks[0]
  const task = first?.task
  if (!first || !task) return
  const one = tasks.length === 1
  const open = tasks.some((row) => !row.task?.done && !row.task?.cancelled)
  const at = 'clientX' in event ? pointBox(event) : event
  const items: MenuEntry[] = [
    ...(select ? [{ label: t('Select'), run: select }, DIVIDER] : []),
    { label: open ? t('Complete') : t('Reopen'), run: () => void tickRows(tasks, kit.live.today) },
    { label: t('Schedule'), asks: true, run: () => scheduleRows(tasks, at, kit) },
    more(t('Priority'), () =>
      priorityEntries(one ? task.priority : 0, (priority) => void prioritise(tasks, priority)),
    ),
    more(t('Labels'), () => labelEntries(tasks)),
    more(t('Move to'), () => moveEntries(tasks)),
    DIVIDER,
    { label: t('Duplicate'), run: () => void duplicateRows(tasks) },
    { label: t('Copy link'), run: () => void copyLinks(tasks) },
    ...(one ? [{ label: t('Open in note'), run: () => kit.open(first, 'aside') }] : []),
    DIVIDER,
    { label: t('Delete'), danger: true, run: () => void deleteRows(tasks) },
  ]
  menu.show('clientX' in event ? event : pointEvent(event), items)
}

/** The links to these tasks, one a line, on the clipboard. */
async function copyLinks(rows: readonly Row[]): Promise<void> {
  const links: string[] = []
  for (const row of rows) {
    const link = await linkToRow(row)
    if (link) links.push(link)
  }
  if (links.length) await copyText(links.join('\n'))
}

/** A menu of these entries under a row. */
function menuAt(at: Box, items: MenuEntry[]): void {
  if (items.length) menu.show(pointEvent(at), items)
}

/** A key of row-keys.ts done to these rows - the one the keyboard is on, or every one
 *  selected - with `at` the row's box, for what opens beside it. Answers whether it was
 *  one of a row's own; stepping, selecting, folding and adding are the layout's, which
 *  knows what is above and below. */
export function runKey(kit: Kit, rows: readonly Row[], key: RowKey, at: Box): boolean {
  const first = rows[0]
  if (!first) return false
  if (key.kind === 'open') kit.choose(first)
  else if (key.kind === 'note') kit.open(first, 'aside')
  else return runTaskKey(kit, rows, key, at)
  return true
}

/** The keys that are about tasks, done to the tasks among the rows. */
function runTaskKey(kit: Kit, rows: readonly Row[], key: RowKey, at: Box): boolean {
  const tasks = rows.filter((row) => row.task)
  const task = tasks[0]
  if (!task) return false
  const one = tasks.length === 1
  switch (key.kind) {
    case 'tick':
      void tickRows(tasks, kit.live.today)
      return true
    case 'schedule':
      scheduleRows(tasks, at, kit)
      return true
    case 'undate':
      void undate(tasks)
      return true
    case 'priority':
      void prioritise(tasks, key.priority)
      return true
    case 'priorities':
      menuAt(
        at,
        priorityEntries(one ? (task.task?.priority ?? 0) : 0, (priority) => {
          void prioritise(tasks, priority)
        }),
      )
      return true
    case 'labels':
      menuAt(at, labelEntries(tasks))
      return true
    case 'project':
      menuAt(at, moveEntries(tasks))
      return true
    case 'more':
      taskMenu(at, tasks, kit)
      return true
    case 'move':
      if (one) void moveRow(task, key.up)
      return true
    case 'indent':
      if (one) void indentRow(task, key.deeper)
      return true
    case 'delete':
      void deleteRows(tasks)
      return true
    case 'link':
      void copyLinks(tasks)
      return true
    case 'step':
    case 'open':
    case 'note':
    case 'pick':
    case 'unpick':
    case 'fold':
    case 'add':
    case 'edit':
      return false
  }
}

/** The box a press is, for a layer put up where the pointer was. */
function pointBox(event: MouseEvent): Box {
  return { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }
}

/** A press at a box's corner, for the menu a key opens under its row. */
function pointEvent(at: Box): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: at.left, clientY: at.bottom })
}
