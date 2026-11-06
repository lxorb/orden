import { writeProperty } from '@orden/markdown/property-edits'
import { addDays, addMonths, formatDate } from './dates'
import { nextDate, parseRule } from './recurrence'
import type { Value } from './types'

export interface Filling {
  title: string
  today: string
  time: string
}

function shifted(today: string, by: string | undefined): string {
  if (!by) return today
  const found = /^([+-])(\d+)([dwMy])$/.exec(by)
  if (!found) return today
  const amount = Number(found[2]) * (found[1] === '-' ? -1 : 1)
  switch (found[3] ?? 'd') {
    case 'w':
      return addDays(today, amount * 7)
    case 'M':
      return addMonths(today, amount)
    case 'y':
      return addMonths(today, amount * 12)
    default:
      return addDays(today, amount)
  }
}

const PLACEHOLDER = /\{\{\s*(title|date|time)\s*([+-]\d+[dwMy])?\s*(?::([^}]*))?\}\}/g

export function fillTemplate(text: string, filling: Filling): string {
  return text.replace(
    PLACEHOLDER,
    (_written, name: string, by: string | undefined, format: string | undefined) => {
      if (name === 'title') return filling.title
      const iso = shifted(filling.today, by)
      const value = { kind: 'date' as const, iso, time: `${filling.time}:00` }
      if (format?.trim()) return formatDate(value, format.trim())
      return name === 'time' ? filling.time : iso
    },
  )
}

const TEMPLATE_KEYS = ['repeat', 'made', 'folder'] as const

export function withoutTemplateKeys(text: string): string {
  let out = text
  for (const key of TEMPLATE_KEYS) {
    const edit = writeProperty(out, key, null)
    if (edit) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }
  return out.replace(/^---\r?\n---\r?\n(\r?\n)?/, '')
}

function dayIn(value: Value | undefined): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'date')
    return typeof value.iso === 'string' ? value.iso : null
  return null
}

export function repeatDue(
  note: Record<string, Value>,
  today: string,
): { day: string; missed: string[] } | null {
  const said = note.repeat
  if (typeof said !== 'string') return null
  const rule = parseRule(said.replace(/^🔁\s*/u, ''))
  if (!rule) return null
  const made = dayIn(note.made) ?? addDays(today, -1)
  const days: string[] = []
  for (let after = made; days.length < 400;) {
    const next = nextDate(rule, made, after)
    if (next === null || next > today) break
    days.push(next)
    after = next
  }
  const day = days.pop()
  return day === undefined ? null : { day, missed: days }
}
