/** A table of rows: an Airtable CSV, and every database in a Notion export.
 *
 *  A table is the one import with a real choice in it, because the same file is
 *  honestly two things. A recipe list is a table: forty rows of four columns,
 *  and what somebody wants is to see it. A reading list where every row has a
 *  page of notes behind it is forty notes, and a table of their titles is worse
 *  than useless.
 *
 *  Nothing in the file says which, so the sheet asks, once, with the answer that
 *  is right more often already chosen: a table. The other answer is one note per
 *  row, with the row's columns as its properties, which is the shape a Notion
 *  database row already had - and a `.base` beside their folder showing them as a
 *  table again, so what came in as a database is one (docs/tasks.md 4, "import CSV
 *  as a base"). */

import { key } from '../i18n.svelte'
import { recordsOf } from './csv'
import { type Base, writeBase } from '@nib/bases'
import { dayOf, noteText, type Meta, propertyName } from './meta'
import { Names, safeName, withoutNotionId } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** What a table becomes. */
export type Rows = 'table' | 'notes'

/** A table's file: a CSV, or the tab separated kind a spreadsheet also saves. Which
 *  of the two separates the cells is asked of the file itself; see csv.ts. */
const TABLE = /\.(csv|tsv)$/i

/** The columns that are a date rather than a word, by the names the two
 *  exporters give them. */
const DATES = /^(created|created time|created at|date|last edited time|last modified|updated)$/i

/** The column a row is named after, when it is not simply the first one. */
const TITLES = /^(name|title|task|subject)$/i

export async function readTable(
  sources: readonly Source[],
  rows: Rows = 'table',
): Promise<ImportPlan> {
  const names = new Names()
  const files: Planned[] = []
  const lost: Lost[] = []

  // Notion writes a database twice, as the view on screen and as `_all`, every
  // row; where both came, the second is the table.
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

    // A folder of the table's name, so forty notes do not land loose in the
    // space and the table itself is still one thing in the file list.
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
    lost.push({ text: key('There are no rows in this file.') })
  }

  return { format: 'table', files, lost }
}

/** The rows as a markdown table. Wide tables are left wide: a table somebody
 *  exported is the shape they made it, and a note scrolls sideways. */
export function tableOf(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const head = `| ${columns.map(cell).join(' | ')} |`
  const rule = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${columns.map((one) => cell(row[one] ?? '')).join(' | ')} |`)

  return [head, rule, ...body].join('\n')
}

/** One cell, safe to put between two pipes: a pipe of its own is escaped, and the
 *  newlines in a paragraph somebody typed into a spreadsheet become spaces,
 *  because a markdown table has no way to hold a line break. */
function cell(value: string): string {
  return value
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

/** One row as a note: its columns are its properties, and the column it is named
 *  after is its title. A column holding a paragraph becomes the note's words
 *  instead of a property, since that is what it is. */
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
    // The title is the note's name, and kept as a property as well only where the
    // name could not say it: a web address, a title with a slash in it, one longer
    // than a name may be. Otherwise nothing of it would be left.
    if (!value || (column === titleColumn && !renamed(value, name))) continue

    if (DATES.test(column) && (key === 'date' || key === 'updated')) {
      const day = dayIn(value)
      if (day) {
        meta[key] ??= day
        continue
      }
    }

    // Anything with a line in it is prose, and prose in front matter is a
    // property nobody can read.
    if (value.includes('\n')) {
      words.push(`## ${column}\n\n${value}`)
      continue
    }

    extra.push([key, value])
  }

  if (extra.length) meta.extra = extra

  // The title is written here rather than left to `noteText`, which would take the
  // `## Notes` of a first column of prose for the note's own heading and give it none.
  return { name, text: noteText(null, [`# ${name}`, ...words].join('\n\n'), meta) }
}

/** The column a row is named after: the one that says so, or the first. */
function titleOf(columns: readonly string[]): string {
  return columns.find((one) => TITLES.test(one)) ?? columns[0] ?? ''
}

/** Whether a title had to change to be a name, beyond its blanks. */
function renamed(title: string, name: string): boolean {
  return title.replace(/\s+/g, ' ') !== name
}

/** The property each column is written as, the same in every row and in the base.
 *
 *  A date column is the note's `date` or `updated`. Two columns that come out as one
 *  key - `Status?` and `Status!`, or a `Created` and a `Date` - would be one property
 *  written twice, which is front matter no reader takes at all, so the second steps
 *  aside as `status-2`. A column whose name has nothing in it to keep is called after
 *  its place. The date columns are asked first, so the one that says when a row was
 *  made is the note's `date` whatever stands before it. */
function keysOf(columns: readonly string[]): Map<string, string> {
  const keys = new Map<string, string>()
  const taken = new Set<string>()
  const take = (column: string, wanted: string) => {
    let key = wanted
    for (let step = 2; taken.has(key); step += 1) key = `${wanted}-${step}`
    taken.add(key)
    keys.set(column, key)
  }

  for (const column of columns) {
    if (DATES.test(column)) take(column, /created|^date$/i.test(column) ? 'date' : 'updated')
  }
  for (const [at, column] of columns.entries()) {
    if (!keys.has(column)) take(column, propertyName(column) || `column-${at + 1}`)
  }

  return keys
}

/** The day a date column says, or null where it says less than a day. A spreadsheet
 *  column called Date holds `12` or `March 2026` as often as a date, and the webview's
 *  own reading of those is a day it made up - `12` is the first of December 2001 -
 *  so a day is only read where a year and a day are both written. `4.3.2026` is the
 *  fourth of March, as everywhere that writes dates with dots. */
function dayIn(value: string): string | null {
  if (/^\d{10,19}$/.test(value)) return dayOf(value)

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/.exec(value)
  if (dotted) return dayOf(`${dotted[3]}-${dotted[2]}-${dotted[1]}`)

  const year = /(?<!\d)\d{4}(?!\d)/.test(value)
  const day = /(?<!\d)\d{1,2}(?!\d)/.test(value)
  return year && day ? dayOf(value) : null
}

/** Whether a row's title is one its note keeps as a property too. */
function renamedRow(title: string): boolean {
  const said = title.trim()
  return said !== '' && renamed(said, safeName(said))
}

/** The base over a folder of row notes: a table of them, the columns in the file's
 *  order under the names the notes write them with. The folder is matched by its name
 *  wherever the import is put, since the plan does not know where that is. */
function baseOf(
  folder: string,
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const title = titleOf(columns)
  const keys = keysOf(columns)
  const order = columns
    .filter((one) => !rows.some((row) => (row[one] ?? '').includes('\n')))
    // The title column is a property only in the rows whose title is not their name.
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
        nib: { kept: {} },
        options: {},
      },
    ],
    nib: { properties: {}, kept: {} },
    kept: {},
  }
  return writeBase(base)
}
