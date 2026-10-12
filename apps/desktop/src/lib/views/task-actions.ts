/** What can be done to a task from a view, in one place: schedule it (the scheduler,
 *  for one task or many as one write), and its menu - complete, schedule, priority,
 *  duplicate, copy its link, open it in its note, delete. The row's ⋯, its context menu
 *  and the keys reach the same functions, so a task is scheduled one way from
 *  everywhere.
 *
 *  Every write is the views' one write path (act.ts): one edit of each note it touches,
 *  one undo. */

import type { Priority, Row } from '@nib/bases'
import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { deleteRows, duplicateRow, linkToRow, writeEach } from './act'
import type { Kit } from './kit'
import { changeFor, loadByDay } from './schedule/schedule'
import { type Box, showScheduler } from './schedule/scheduling.svelte'

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
function prioritise(rows: readonly Row[], priority: Priority): Promise<boolean> {
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

/** A task's own menu: from its ⋯, a press with the other button, or the `.` key. */
export function taskMenu(event: MouseEvent | Box, row: Row, kit: Kit): void {
  const task = row.task
  if (!task) return
  const open = !task.done && !task.cancelled
  const items: MenuEntry[] = [
    {
      label: open ? t('Complete') : t('Reopen'),
      run: () => kit.tick(row),
    },
    {
      label: t('Schedule'),
      asks: true,
      run: () => {
        const at = 'clientX' in event ? pointBox(event) : event
        scheduleRows([row], at, kit)
      },
    },
    {
      label: t('Priority'),
      run: () => undefined,
      more: () =>
        Promise.resolve(
          priorityEntries(task.priority, (priority) => void prioritise([row], priority)),
        ),
    },
    DIVIDER,
    { label: t('Duplicate'), run: () => void duplicateRow(row) },
    {
      label: t('Copy link'),
      run: () => void linkToRow(row).then((link) => (link ? copyText(link) : undefined)),
    },
    { label: t('Open in note'), run: () => kit.open(row, 'aside') },
    DIVIDER,
    { label: t('Delete'), danger: true, run: () => void deleteRows([row]) },
  ]
  if ('clientX' in event) menu.show(event, items)
  else menu.show(pointEvent(event), items)
}

/** The box a press is, for a layer put up where the pointer was. */
function pointBox(event: MouseEvent): Box {
  return { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }
}

/** A press at a box's corner, for the menu a key opens under its row. */
function pointEvent(at: Box): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: at.left, clientY: at.bottom })
}
