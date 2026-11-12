import { plainWords } from '@orden/markdown/escapes'
import { recordsOf } from './csv'
import { type Base, writeBase } from '@orden/bases'
import { dayOf, freeKey, noteText, type Meta, propertyName, titleHeading } from './meta'
import { Names, safeName, withoutNotionId } from './names'
import type { ImportPlan, Planned } from './plan'
import type { Source } from './sources'

export type Rows = 'table' | 'notes'

const TABLE = /\.(csv|tsv)$/i

const DATES = /^(created|created time|created at|date|last edited time|last modified|updated)$/i

const TITLES = /^(name|title|task|subject)$/i

export async function readTable(
  sources: readonly Source[],
  rows: Rows = 'table',
): Promise<ImportPlan> {
  const names = new Names()
  const files: Planned[] = []
  const lost: string[] = []

  const paths = new Set(sources.map((one) => one.path.toLowerCase()))

  for (const source of sources) {
    if (!TABLE.test(source.path)) continue
    const all = source.path.toLowerCase().replace(/\.csv$/, '_all.csv')
    if (all !== source.path.toLowerCase() && paths.has(all)) continue

    const name = (source.path.split('/').pop() ?? source.path).replace(/_all(\.csv)$/i, '$1')
    const stem = safeName(withoutNotionId(name.replace(TABLE, '')))
    const table = recordsOf(await source.text())
    if (!table.columns.length) continue

    if (rows === 'table') {
      files.push({
        kind: 'note',
        path: names.free(`${stem}.md`),
        text: noteText(stem, tableOf(table.columns, table.rows)),
      })
      continue
    }

    const folder = names.free(stem)
    for (const row of table.rows) {
      const note = rowNote(table.columns, row)
      files.push({
        kind: 'note',
        path: names.free(`${folder}/${note.name}.md`),
        text: note.text,
      })
    }
    files.push({
      kind: 'note',
      path: names.free(`${stem}.base`),
      text: baseOf(folder, table.columns, table.rows),
    })
  }

  if (!files.length) {
    lost.push('There are no rows in this file.')
  }

  return { format: 'table', files, lost }
}

export function tableOf(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const head = `| ${columns.map(cell).join(' | ')} |`
  const rule = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${columns.map((one) => cell(row[one] ?? '')).join(' | ')} |`)

  return [head, rule, ...body].join('\n')
}

function cell(value: string): string {
  return plainWords(value.replace(/\s*\n\s*/g, ' ').trim()).replace(/\|/g, '\\|')
}

export function rowNote(
  columns: readonly string[],
  row: Record<string, string>,
): { name: string; text: string } {
  const titleColumn = titleOf(columns)
  const said = (row[titleColumn] ?? '').trim()
  const name = safeName(said.split('\n')[0] ?? '') || 'Untitled'
  const keys = keysOf(columns)

  const meta: Meta = {}
  const extra: [string, string][] = []
  const words: string[] = []

  for (const column of columns) {
    const value = (row[column] ?? '').trim()
    const key = keys.get(column) ?? ''
    if (!value || (column === titleColumn && !renamed(value, name))) continue

    if (DATES.test(column) && (key === 'date' || key === 'updated')) {
      const day = dayIn(value)
      if (day) {
        meta[key] ??= day
        continue
      }
    }

    if (value.includes('\n')) {
      words.push(`## ${plainWords(column)}\n\n${plainWords(value)}`)
      continue
    }

    extra.push([key, value])
  }

  if (extra.length) meta.extra = extra

  return { name, text: noteText(null, [titleHeading(name), ...words].join('\n\n'), meta) }
}

function titleOf(columns: readonly string[]): string {
  return columns.find((one) => TITLES.test(one)) ?? columns[0] ?? ''
}

function renamed(title: string, name: string): boolean {
  return title.replace(/\s+/g, ' ') !== name
}

function keysOf(columns: readonly string[]): Map<string, string> {
  const keys = new Map<string, string>()
  const taken = new Set<string>()
  const take = (column: string, wanted: string) => keys.set(column, freeKey(wanted, taken))

  for (const column of columns) {
    if (DATES.test(column)) take(column, /created|^date$/i.test(column) ? 'date' : 'updated')
  }
  for (const [at, column] of columns.entries()) {
    if (!keys.has(column)) take(column, propertyName(column) || `column-${at + 1}`)
  }

  return keys
}

function dayIn(value: string): string | null {
  if (/^\d{10,19}$/.test(value)) return dayOf(value)

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/.exec(value)
  if (dotted) return dayOf(`${dotted[3]}-${dotted[2]}-${dotted[1]}`)

  const year = /(?<!\d)\d{4}(?!\d)/.test(value)
  const day = /(?<!\d)\d{1,2}(?!\d)/.test(value)
  return year && day ? dayOf(value) : null
}

function renamedRow(title: string): boolean {
  const said = title.trim()
  return said !== '' && renamed(said, safeName(said))
}

function baseOf(
  folder: string,
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const title = titleOf(columns)
  const keys = keysOf(columns)
  const order = columns
    .filter((one) => !rows.some((row) => (row[one] ?? '').includes('\n')))
    .filter((one) => one !== title || rows.some((row) => renamedRow(row[one] ?? '')))
    .map((one) => keys.get(one) ?? '')
  const base: Base = {
    filters: {
      or: [
        `file.folder == ${JSON.stringify(folder)}`,
        `file.folder.endsWith(${JSON.stringify(`/${folder}`)})`,
      ],
    },
    formulas: {},
    properties: {},
    summaries: {},
    views: [
      {
        type: 'table',
        name: 'Table',
        order: ['file.name', ...new Set(order.map((one) => `note.${one}`))],
        sort: [],
        summaries: {},
        orden: { kept: {} },
        options: {},
      },
    ],
    orden: { properties: {}, kept: {} },
    kept: {},
  }
  return writeBase(base)
}
