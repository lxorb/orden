import type { Row, TaskRow, Value } from '@orden/bases'
import { amount } from '../i18n.svelte'
import { isDateValue, isDurationValue, isLinkValue } from './values'
import { plain } from './inline'
import { dayWords } from '@orden/editor/task-days'
import { deadlineOf, startOf } from '@orden/markdown/task-dates'

export interface Chip {
  kind: 'date' | 'time' | 'repeat' | 'duration' | 'deadline' | 'remind' | 'assignee'
  text: string
  late?: boolean
}

function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${amount(rest)}m`
  return rest ? `${amount(hours)}h ${amount(rest)}m` : `${amount(hours)}h`
}

export function chipsOf(task: TaskRow, today: string, dated = true): Chip[] {
  const out: Chip[] = []
  const day = startOf(task, task.dueReads) ?? task.scheduled
  const open = !task.done && !task.cancelled
  if (dated && day && day > today) out.push({ kind: 'date', text: dayWords(day, today) })
  if (task.time) out.push({ kind: 'time', text: task.time })
  if (task.recurrence) out.push({ kind: 'repeat', text: '↻' })
  if (task.duration !== undefined) out.push({ kind: 'duration', text: minutesText(task.duration) })
  const deadline = deadlineOf(task, task.dueReads)
  if (deadline) {
    out.push({
      kind: 'deadline',
      text: `⚑ ${dayWords(deadline, today)}`,
      ...(open && deadline < today ? { late: true } : {}),
    })
  }
  if (task.remind.length) out.push({ kind: 'remind', text: '🔔' })
  if (task.assignee) out.push({ kind: 'assignee', text: `+${task.assignee}` })
  return out
}

export function valueText(value: Value, today: string): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return amount(value)
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (Array.isArray(value))
    return value
      .map((one) => valueText(one, today))
      .filter(Boolean)
      .join(', ')
  if (isDateValue(value)) return dayWords(value.iso, today, value.time?.slice(0, 5))
  if (isDurationValue(value)) return minutesText(Math.round(value.ms / 60_000))
  if (isLinkValue(value))
    return value.display ?? (value.target.split('/').pop() ?? value.target).replace(/\.md$/i, '')
  if ('kind' in value && 'name' in value && typeof value.name === 'string') return value.name
  if ('kind' in value && 'src' in value && typeof value.src === 'string') return value.src
  return ''
}

export function toneColour(tone: string | undefined): string | null {
  switch (tone) {
    case undefined:
      return null
    case 'danger':
    case 'red':
    case '1':
      return 'var(--canvas-1)'
    case 'warning':
    case 'orange':
    case '2':
      return 'var(--canvas-2)'
    case 'yellow':
    case '3':
      return 'var(--canvas-3)'
    case 'success':
    case 'green':
    case '4':
      return 'var(--canvas-4)'
    case 'info':
    case 'cyan':
    case '5':
      return 'var(--canvas-5)'
    case 'purple':
    case '6':
      return 'var(--canvas-6)'
    default:
      return null
  }
}

export function blockerOf(task: TaskRow, rows: readonly Row[]): string | null {
  for (const row of rows) {
    const other = row.task
    if (!other?.id || other.done || other.cancelled) continue
    if (task.dependsOn.includes(other.id)) return plain(other.text)
  }
  return null
}
