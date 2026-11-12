import type { Priority, Row } from '@orden/bases'
import { copyText } from '../clipboard'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { rows as store } from '../rows/rows.svelte'
import { insideSpace, samePath } from '../space-paths'
import { workspace } from '../workspace.svelte'
import {
  deleteRows,
  duplicateRows,
  finishRows,
  indentRow,
  linkToRow,
  moveRow,
  moveRowsTo,
  skipRows,
  tickRows,
  writeEach,
} from './act'
import type { Kit } from './kit'
import { offersPlaces, placeEntries } from './project-actions'
import type { RowKey } from './row-keys'
import { deadlineField, deadlineOf, startOf } from '@orden/markdown/task-dates'
import { changeFor, loadByDay } from './schedule/schedule'
import { type Box, showScheduler } from './schedule/scheduling.svelte'
import { labelsOf } from './task-meta'

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
      due: startOf(first, first.dueReads) ?? first.scheduled,
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
    ...(tasks.every((row) => row.task?.recurrence)
      ? { skip: () => void skipRows(tasks, kit.live.today) }
      : {}),
  })
}

export function scheduleDeadline(rows: Row | readonly Row[], from: Element | Box, kit: Kit): void {
  const tasks: Row[] = (Array.isArray(rows) ? [...(rows as readonly Row[])] : [rows as Row]).filter(
    (row) => row.task,
  )
  const first = tasks[0]?.task
  if (!first) return
  showScheduler(from, {
    current: { due: deadlineOf(first, first.dueReads) },
    today: kit.live.today,
    load: loadByDay(kit.live.rows),
    dateOnly: true,
    pick: (picked) =>
      void writeEach(
        tasks.map((row: Row) => {
          const task = row.task
          const field = task ? deadlineField(task, task.dueReads) : 'deadline'
          return { row, change: { task: { [field]: picked.due } } }
        }),
      ),
  })
}

export function prioritise(rows: readonly Row[], priority: Priority): Promise<boolean> {
  return writeEach(
    rows.filter((row) => row.task).map((row) => ({ row, change: { task: { priority } } })),
  )
}

export function priorityEntries(current: number, set: (priority: Priority) => void): MenuEntry[] {
  return ([1, 2, 3, 4] as const).map((level) => ({
    label: `Priority ${level}`,
    checked: current === level,
    run: () => set(level),
  }))
}

function undate(rows: readonly Row[]): Promise<boolean> {
  const tasks = rows.filter((row) => row.task)
  return writeEach(
    tasks.map((row) => ({ row, change: { task: changeFor(row.task ?? null, { due: null }) } })),
    false,
    'scheduled',
  )
}

export function labelEntries(rows: readonly Row[]): MenuEntry[] {
  const tasks = rows.filter((row) => row.task)
  const space = tasks[0]?.space
  return labelsOf(space === undefined ? [] : store.shown(space)).map((tag) => {
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

function tasksRoot(rows: readonly Row[]): string | null {
  const tasks = rows.filter((row) => row.task)
  const space = tasks[0]?.space
  if (space === undefined || tasks.some((row) => row.space !== space)) return null
  return workspace.spaces.find((one) => one.name === space)?.root ?? null
}

export function moveEntries(rows: readonly Row[]): MenuEntry[] {
  const tasks = rows.filter((row) => row.task)
  const root = tasksRoot(tasks)
  if (root === null) return []
  return placeEntries(
    (path) => void moveRowsTo(tasks, path),
    (note) => tasks.every((row) => samePath(insideSpace(root, row.path), note)),
    root,
  )
}

function more(label: string, entries: () => MenuEntry[]): MenuEntry {
  return { label, run: () => undefined, more: () => Promise.resolve(entries()) }
}

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
    ...(select ? [{ label: 'Select', run: select }, DIVIDER] : []),
    { label: open ? 'Complete' : 'Reopen', run: () => void tickRows(tasks, kit.live.today) },
    { label: 'Schedule', asks: true, run: () => scheduleRows(tasks, at, kit) },
    ...(tasks.every((row) => row.task?.recurrence) && open
      ? [
          { label: 'Skip', run: () => void skipRows(tasks, kit.live.today) },
          { label: 'Complete forever', run: () => void finishRows(tasks) },
        ]
      : []),
    more('Priority', () =>
      priorityEntries(one ? task.priority : 0, (priority) => void prioritise(tasks, priority)),
    ),
    more('Labels', () => labelEntries(tasks)),
    ...(offersPlaces(tasksRoot(tasks)) ? [more('Move to', () => moveEntries(tasks))] : []),
    DIVIDER,
    { label: 'Duplicate', run: () => void duplicateRows(tasks) },
    { label: 'Copy link', run: () => void copyLinks(tasks) },
    ...(one ? [{ label: 'Open in note', run: () => kit.open(first, 'aside') }] : []),
    DIVIDER,
    { label: 'Delete', danger: true, run: () => void deleteRows(tasks) },
  ]
  menu.show('clientX' in event ? event : pointEvent(event), items)
}

async function copyLinks(rows: readonly Row[]): Promise<void> {
  const links: string[] = []
  for (const row of rows) {
    const link = await linkToRow(row)
    if (link) links.push(link)
  }
  if (links.length) await copyText(links.join('\n'))
}

function menuAt(at: Box, items: MenuEntry[]): void {
  if (items.length) menu.show(pointEvent(at), items)
}

export function runKey(kit: Kit, rows: readonly Row[], key: RowKey, at: Box): boolean {
  const first = rows[0]
  if (!first) return false
  if (key.kind === 'open') kit.choose(first)
  else if (key.kind === 'note') kit.open(first, 'aside')
  else if (key.kind === 'comment' && first.task) kit.openTask(first, true)
  else return runTaskKey(kit, rows, key, at)
  return true
}

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
    case 'comment':
    case 'pick':
    case 'unpick':
    case 'fold':
    case 'add':
    case 'edit':
      return false
  }
}

function pointBox(event: MouseEvent): Box {
  return { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }
}

function pointEvent(at: Box): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: at.left, clientY: at.bottom })
}
