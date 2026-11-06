import { readTint } from '../icons'

export const LONGEST_NAME = 80

const LONGEST_NOTE = 1000

const MOST_TAGS = 12

const LONGEST_TAG = 40

export interface Activity {
  id: string
  name: string
  tint: string | null
  parent: string | null
  archived: boolean
  order: number
}

type Source = 'manual' | 'timer' | 'space' | 'site'

const SOURCES: readonly Source[] = ['manual', 'timer', 'space', 'site']

export interface Span {
  id: string
  start: number
  end: number | null
  activity: string | null
  tags: string[]
  note: string
  source: Source
  space: string | null
  site: string | null
  device: string | null
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const textOr = (value: unknown, longest: number, otherwise = ''): string =>
  typeof value === 'string' ? value.slice(0, longest) : otherwise

const idOr = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const one of value as unknown[]) {
    const tag = typeof one === 'string' ? one.trim().slice(0, LONGEST_TAG) : ''
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length === MOST_TAGS) break
  }
  return out
}

export function activityOf(id: string, value: Record<string, unknown>): Activity | null {
  const name = textOr(value.name, LONGEST_NAME).trim()
  if (!name) return null
  return {
    id,
    name,
    tint: readTint(typeof value.tint === 'string' ? value.tint : null),
    parent: idOr(value.parent),
    archived: value.archived === true,
    order: isTime(value.order) ? value.order : 0,
  }
}

export function spanOf(id: string, value: Record<string, unknown>): Span | null {
  if (!isTime(value.start)) return null
  const end = value.end ?? null
  if (end !== null && (!isTime(end) || end < value.start)) return null
  return {
    id,
    start: value.start,
    end,
    activity: idOr(value.activity),
    tags: tagsOf(value.tags),
    note: textOr(value.note, LONGEST_NOTE),
    source: SOURCES.find((one) => one === value.source) ?? 'manual',
    space: idOr(value.space),
    site: textOr(value.site, 253) || null,
    device: idOr(value.device),
  }
}

export function activityValue(activity: Activity): Record<string, unknown> {
  return {
    name: activity.name,
    tint: activity.tint,
    parent: activity.parent,
    archived: activity.archived,
    order: activity.order,
  }
}

export function spanValue(span: Span): Record<string, unknown> {
  return {
    start: span.start,
    end: span.end,
    activity: span.activity,
    tags: span.tags,
    note: span.note,
    source: span.source,
    space: span.space,
    site: span.site,
    device: span.device,
  }
}
