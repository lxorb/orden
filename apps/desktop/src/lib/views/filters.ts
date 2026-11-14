import { answer, type Base, fromTodoist, type Row, type View, writeBase } from '@orden/bases'
import { canWriteAt } from '../sharing.svelte'
import { joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { contextFor } from './context'

const FILTERS = 'Filters'

interface Reading {
  lang?: string
  today: string
}

export function filterBase(name: string, query: string, reading: Reading): Base {
  const lists = splitLists(query)
  const filters = fromTodoist(query, {
    ...(reading.lang ? { lang: reading.lang } : {}),
    today: reading.today,
  })
  const views: View[] = filters.map((one, at) => ({
    type: 'list',
    name: at === 0 ? name : (lists[at] ?? ''),
    filters: one,
    sort: [
      { property: 'task.date', direction: 'ASC' },
      { property: 'task.priority', direction: 'ASC' },
    ],
    order: [],
    summaries: {},
    options: {},
    orden: { rows: 'tasks', kept: { todoist: lists[at] ?? query } },
  }))
  return {
    formulas: {},
    properties: {},
    summaries: {},
    views,
    orden: { properties: {}, kept: { todoist: query } },
    kept: {},
  }
}

function splitLists(query: string): string[] {
  const out: string[] = []
  let depth = 0
  let list = ''
  for (const char of query) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      out.push(list)
      list = ''
    } else list += char
  }
  return [...out, list].map((one) => one.trim()).filter(Boolean)
}

export function queryOf(base: Base): string | null {
  const kept = base.orden.kept.todoist
  return typeof kept === 'string' && kept.trim() ? kept : null
}

export function counted(
  query: string,
  rows: readonly Row[],
  reading: Reading,
): { count: number } | { error: string } {
  if (!query.trim()) return { count: 0 }
  try {
    const base = filterBase('', query, reading)
    const context = contextFor({ rows, today: reading.today, now: `${reading.today}T00:00:00` })
    const count = base.views.reduce((sum, _, at) => sum + answer(base, at, rows, context).total, 0)
    return { count }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
