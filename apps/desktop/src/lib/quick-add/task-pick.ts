import { todayOf } from '@orden/bases'
import {
  deadlineField,
  deadlineOf,
  type DueReads,
  startField,
  startOf,
} from '@orden/markdown/task-dates'
import type { TaskChange } from '@orden/markdown/task-edits'
import type { TaskFields } from '@orden/markdown/task-line'
import { DIVIDER, type MenuEntry, menu } from '../menu.svelte'
import { dayRows, durationRows, priorityRows, remindRows } from './pickers'

const RULES: [string, () => string][] = [
  ['every day', () => 'Every day'],
  ['every weekday', () => 'Every weekday'],
  ['every week', () => 'Every week'],
  ['every month', () => 'Every month'],
  ['every year', () => 'Every year'],
]

function repeatRows(current: string | undefined, set: (rule: string | null) => void): MenuEntry[] {
  return [
    ...RULES.map(([rule, said]) => ({
      label: said(),
      checked: current === rule,
      run: () => set(rule),
    })),
    ...(current ? [DIVIDER, { label: 'Remove', run: () => set(null) }] : []),
  ]
}

function rowsFor(
  field: string,
  fields: TaskFields,
  at: DOMRect,
  due: DueReads,
  change: (change: TaskChange) => void,
): MenuEntry[] {
  const today = todayOf()
  switch (field) {
    case 'date': {
      const written = startField(fields, due)
      return dayRows(
        { due: startOf(fields, due) ?? fields.scheduled, time: fields.time },
        today,
        (when) => {
          const { due: day, ...rest } = when
          change({ ...rest, [written]: day })
        },
        () => at,
      )
    }
    case 'deadline': {
      const written = deadlineField(fields, due)
      return dayRows(
        { due: deadlineOf(fields, due) },
        today,
        (when) => change({ [written]: when.due }),
        () => at,
        false,
      )
    }
    case 'priority':
      return priorityRows(fields.priority, (priority) => change({ priority }))
    case 'remind':
      return remindRows(fields.remind, fields, today, (remind) => change({ remind }))
    case 'duration':
      return durationRows(fields.duration, (duration) => change({ duration }))
    case 'recurrence':
      return repeatRows(fields.recurrence, (recurrence) => change({ recurrence }))
    default:
      return []
  }
}

export function pickField(
  field: string,
  fields: TaskFields,
  at: DOMRect,
  due: DueReads,
  change: (change: TaskChange) => void,
): void {
  const rows = rowsFor(field, fields, at, due, change)
  if (!rows.length) return
  menu.show(new MouseEvent('contextmenu', { clientX: at.left, clientY: at.bottom }), rows)
}
