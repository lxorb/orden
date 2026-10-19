/** Todoist's filters, the nib way: a filter is a `.base` file in the space's `Filters/`
 *  folder, its view's filter the Todoist query read into Bases' own (`fromTodoist`), and
 *  the words it was written in kept beside it (`nib.todoist`), so it is edited as it was
 *  typed and Obsidian reads the base without knowing Todoist at all. Each list of a query
 *  a comma separates is a view of its own, as Todoist draws them one under another.
 *
 *  Pure, but for `saveFilter`, which writes the file. */

import { answer, type Base, fromTodoist, type Row, type View, writeBase } from '@nib/bases'
import { joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { contextFor } from './context'

/** The folder a space's filters are made in. */
const FILTERS = 'Filters'

interface Reading {
  lang?: string
  today: string
}

/** A filter as the base it is written as. Throws where Todoist's grammar cannot read
 *  the query, the error saying where. */
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
    nib: { rows: 'tasks', kept: { todoist: lists[at] ?? query } },
  }))
  return {
    formulas: {},
    properties: {},
    summaries: {},
    views,
    nib: { properties: {}, kept: { todoist: query } },
    kept: {},
  }
}

/** The lists of a query a comma at its top level separates, as written. */
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

/** The Todoist query a filter was written from, or null for a base made otherwise. */
export function queryOf(base: Base): string | null {
  const kept = base.nib.kept.todoist
  return typeof kept === 'string' && kept.trim() ? kept : null
}

/** How many open tasks a query finds, or where it cannot be read. */
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

/** A filter written: over the file it was read from, or new in the space's `Filters/`
 *  under its name. Answers the file. */
export async function saveFilter(
  name: string,
  query: string,
  reading: Reading,
  path: string | null,
): Promise<string | null> {
  const root = workspace.activeSpace?.root
  const words = name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (root === undefined || !words) return null
  const yaml = writeBase(filterBase(words, query, reading))
  const folder = joinPath(root, FILTERS)
  const target = path ?? joinPath(folder, workspace.freeName(folder, `${words}.base`))
  await writeFile(target, yaml)
  if (path === null) {
    await workspace.loadTree()
    await workspace.fileCame(target, 'file')
  }
  return target
}
