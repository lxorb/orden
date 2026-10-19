/** A Notion export, which is the one most people arrive with.
 *
 *  Notion writes a folder per page that has pages under it, a file per page, and
 *  an id on the end of every single name: `Plan 1a2b...7890.md` beside
 *  `Plan 1a2b...7890/`. Take the ids off and that is exactly nib's own shape - a
 *  note and a folder of the same name, the note standing for the folder - so a
 *  Notion workspace arrives as the tree it looked like in Notion, with nothing
 *  rearranged.
 *
 *  A database is a CSV beside a folder of the rows' own pages. The CSV becomes
 *  the folder's note, holding the table as a base over the rows, and the rows
 *  come in as the notes they already were: the database is one thing in the file
 *  list that opens into its rows, and a row edited is the table edited. See
 *  notion-database.ts. Notion writes the table twice, once as the view that was
 *  on screen and once as every row; this reads the second, because a filtered
 *  view is a question somebody asked on a Tuesday and the rows are the data.
 *
 *  Each page carries its properties as lines under the title, which become front
 *  matter: that is where nib keeps a note's properties, and it is what makes them
 *  searchable with `[key:value]`. A row's values are written as what their column
 *  holds - a date as a date, a checkbox as a yes-or-no, a relation as links - so
 *  the base can sort, sum and group them. */

import { htmlToMarkdown } from '@nib/markdown/from-html'

import { key } from '../i18n.svelte'
import { folderPlan, isJunk } from './folder'
import { dayOf, type Meta, noteText, propertyName, type Property } from './meta'
import { Names, safeName, safeParts, withoutNotionId } from './names'
import {
  baseBlock,
  type Database,
  databaseOf,
  type Kind,
  kindOf,
  notionDate,
  valueAs,
} from './notion-database'
import type { ImportPlan } from './plan'
import type { Source } from './sources'
import { elements, closingOf, tagsIn, unescapeXml } from './xml'

const HTML = /\.html?$/i
const MARKDOWN = /\.(md|markdown)$/i
const CSV = /\.csv$/i

/** A line under the title that says what the page's property held. Notion writes
 *  the name exactly as the property was called, so a colon and a space is all
 *  there is to go on; the shape of the name is what keeps a sentence out. */
const PROPERTY = /^([A-Z][^:\n.]{0,39}): *(.*)$/

/** The property names that are the page's own dates rather than something
 *  somebody added. */
const MADE = /^(created|created time|created at|date)$/i
const CHANGED = /^(last edited time|last edited|last modified|updated)$/i
const LABELS = /^(tags?|multi-select|select|labels?)$/i

export async function readNotion(exported: readonly Source[]): Promise<ImportPlan> {
  const sources = unwrapped(exported)
  const html = sources.filter((one) => HTML.test(one.path)).length
  const markdown = sources.filter((one) => MARKDOWN.test(one.path)).length

  // Notion offers both, and its HTML export is the one that keeps a page's look.
  // Which arrived is a fact about the file rather than a choice to be made.
  if (html > markdown) return readNotionHtml(sources)

  const names = new Names()
  const kept = usefulCsvs(sources)
  const paths = new Set(sources.map((one) => one.path))
  let views = 0

  // Every database is read before any page is, because a row's page is written
  // with what its column holds, and that is only known from the whole column.
  const databases = new Map<string, Database>()
  const folders = rowFolders(sources, kept)
  const folderOf = (csv: string) => folders.get(csv) ?? csv.replace(/(_all)?\.csv$/i, '')
  for (const source of sources) {
    if (kept.has(source.path)) databases.set(folderOf(source.path), databaseOf(await source.text()))
  }
  // Where each database's folder note went, for the rows that have no page.
  const placed = new Map<string, string>()

  const plan = await folderPlan(sources, {
    format: 'notion',
    place: (source) => {
      if (isJunk(source.path) || isIndex(source.path)) return { to: null }

      if (CSV.test(source.path)) {
        if (!kept.has(source.path)) {
          views += 1
          return { to: null }
        }

        // Named after the folder its rows are in, so it is that folder's note:
        // the folder's name made the way every folder's is, with `.md` after it.
        const path = names.free(
          `${safeParts(`${folderOf(source.path)}/-`, withoutNotionId).slice(0, -2)}.md`,
        )
        const database = databases.get(folderOf(source.path))
        if (database) placed.set(folderOf(source.path), path)
        return {
          to: path,
          read: () => {
            const name = (path.split('/').pop() ?? path).replace(MARKDOWN, '')
            const text = database ? baseBlock(database, keyOf) : ''
            return { text, title: name }
          },
        }
      }

      if (!MARKDOWN.test(source.path))
        return { to: names.free(safeParts(source.path, withoutNotionId)) }

      const kinds = databases.get(parentOf(source.path))?.kinds
      return {
        to: names.free(safeParts(source.path, withoutNotionId)),
        read: (text) => {
          const said = notionPage(text, kinds)
          return {
            text: viewsFollowed(said.body, source.path, paths),
            title: null,
            meta: said.meta,
          }
        },
      }
    },
  })

  for (const [folder, database] of databases) {
    const note = placed.get(folder)
    if (note) plan.files.push(...(await missingRows(database, folder, note, sources, names)))
  }

  if (views) {
    plan.lost.push({
      text: key('{count} saved views are left out, and every row is in the table'),
      // Not a row of its own: a count is filed under its `other` form, and the
      // forms a language wants sit in the catalogue under it. See i18n.svelte.ts.
      one: '{count} saved view is left out, and every row is in the table',
      values: { count: views },
    })
  }

  return plan
}

/** A name Notion wrote with the page's id on the end, and the id. */
const NAMED = /^(.*) ([0-9a-f]{32})$/i

/** The folder each database's rows are in, in the export, by its CSV.
 *
 *  Notion has named it three ways. It was the CSV's own name without the `_all`
 *  and the extension, id and all: `Tasks 1a2b...7890/`. It is now the title
 *  alone, `Tasks/`, with the start and end of the id after it only where two
 *  folders beside each other would otherwise share a name: `Tasks 1a2b-7890/`.
 *  And a database of several sources is named for both, `Tasks <id>_Bugs <id>`,
 *  its rows in `Tasks/Bugs/`. So each spelling is looked for among the folders
 *  the export has, and the first that is there is the one; a database whose rows
 *  came in no folder at all keeps the first spelling. */
function rowFolders(sources: readonly Source[], kept: ReadonlySet<string>): Map<string, string> {
  const folders = new Set<string>()
  for (const one of sources) {
    const parts = one.path.split('/')
    for (let at = 1; at < parts.length; at += 1) folders.add(parts.slice(0, at).join('/'))
  }

  const found = new Map<string, string>()
  for (const csv of kept) {
    const stem = csv.replace(/(_all)?\.csv$/i, '')
    const at = stem.lastIndexOf('/')
    const parent = at === -1 ? '' : stem.slice(0, at + 1)
    const name = stem.slice(at + 1)

    const two = /^(.* [0-9a-f]{32})_(.* [0-9a-f]{32})$/i.exec(name)
    const parts = two ? [two[1] ?? '', two[2] ?? ''] : [name]
    let spellings = ['']
    for (const part of parts) {
      const named = NAMED.exec(part)
      const ways = named
        ? [
            part,
            named[1] ?? '',
            `${named[1] ?? ''} ${(named[2] ?? '').slice(0, 4)}-${(named[2] ?? '').slice(-4)}`,
          ]
        : [part]
      spellings = spellings.flatMap((one) => ways.map((way) => (one ? `${one}/${way}` : way)))
    }

    const there = spellings.find((one) => folders.has(`${parent}${one}`))
    found.set(csv, `${parent}${there ?? stem.slice(at + 1)}`)
  }

  return found
}

function parentOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/** The folder Notion puts the whole export in, inside the zip it downloads:
 *  `Export-` and the export's own id, which is nothing anybody named. */
const WRAPPER = /^Export-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:-Part-\d+)?\//i

/** The export without that folder, so the workspace lands as its pages rather
 *  than one folder called after an id. Only when every file is in one: a large
 *  export comes as several parts, each in its own, and a page in one part links
 *  to a page in another by a path that leaves the folder out. */
function unwrapped(sources: readonly Source[]): readonly Source[] {
  const wrapped = sources.filter((one) => !isJunk(one.path))
  if (!wrapped.length || !wrapped.every((one) => WRAPPER.test(one.path))) return sources

  return sources.map((one) => ({
    path: one.path.replace(WRAPPER, ''),
    text: () => one.text(),
    bytes: () => one.bytes(),
  }))
}

/** The page Notion writes at the top of an export to list what is in it, which
 *  the folders themselves already are. */
function isIndex(path: string): boolean {
  return /^index\.html$/i.test(path)
}

/** A link to a database, which Notion writes to the CSV of the view that was on
 *  screen, goes to the table the database is read from: its `_all` beside it.
 *  Where the export holds no CSV of that name at all, only a page, the database
 *  is a linked view of one somewhere else, which the export writes as a page
 *  under the same name and id, and the link goes to that page rather than to a
 *  file that is not there. */
function viewsFollowed(text: string, from: string, paths: ReadonlySet<string>): string {
  const folder = parentOf(from)
  return text.replace(/\]\(([^()\s]+)\.csv\)/gi, (whole, target: string) => {
    let said: string
    try {
      said = decodeURIComponent(target)
    } catch {
      return whole
    }
    const at = folder ? `${folder}/${said}` : said
    if (paths.has(`${at}_all.csv`)) return `](${target}_all.csv)`
    if (paths.has(`${at}.csv`) || !paths.has(`${at}.md`)) return whole
    return `](${target}.md)`
  })
}

/** The rows the CSV has and no page of the export stands for, as notes of their
 *  own, so that a row is never in Notion's table and missing from nib's. A page
 *  is matched to its row by name, the way Notion named the file after the row's
 *  title; Notion writes a page for every row, so this is usually nothing.
 *
 *  A title that is a mention of a date is the one place the two names part: the
 *  file is named the way the mention read on the day it was exported, `@Today`,
 *  and the CSV writes the day itself, `@August 6, 2025`. So a row no page is
 *  named after is matched by what it holds instead, a page whose properties are
 *  the row's values, before it is taken for a row that has no page. */
async function missingRows(
  database: Database,
  folder: string,
  note: string,
  sources: readonly Source[],
  names: Names,
): Promise<{ kind: 'note'; path: string; text: string }[]> {
  const [title = '', ...rest] = database.columns
  const pages: { name: string; said: Map<string, string> }[] = []
  for (const one of sources) {
    if (!MARKDOWN.test(one.path) || parentOf(one.path) !== folder) continue
    const name = withoutNotionId(one.path.split('/').pop() ?? '').replace(MARKDOWN, '')
    const said = new Map(propertiesOf(await one.text(), database.kinds)?.said ?? [])
    pages.push({ name: matchable(name), said })
  }
  const into = note.replace(MARKDOWN, '')
  const unmatched: Record<string, string>[] = []

  for (const row of database.rows) {
    const name = safeName((row[title] ?? '').split('\n')[0] ?? '')
    const at = pages.findIndex((one) => one.name === matchable(name))
    if (at === -1) unmatched.push(row)
    else pages.splice(at, 1)
  }

  const out: { kind: 'note'; path: string; text: string }[] = []
  for (const row of unmatched) {
    const said = rest.map((column): [string, string] => [column, (row[column] ?? '').trim()])
    const at = pages.findIndex(
      (page) =>
        said.some(([, value]) => value) &&
        said.every(([column, value]) => (page.said.get(column)?.trim() ?? '') === value),
    )
    if (at !== -1) {
      pages.splice(at, 1)
      continue
    }

    const name = safeName((row[title] ?? '').split('\n')[0] ?? '')
    out.push({
      kind: 'note',
      path: names.free(`${into}/${name}.md`),
      text: noteText(name, '', metaOf(said, database.kinds)),
    })
  }

  return out
}

/** A name with nothing in it a file system or an exporter might have changed. */
function matchable(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The key a column is written under in a row's front matter: the page's own
 *  dates and its labels under nib's names for them, every other column under its
 *  own. */
function keyOf(column: string): string {
  if (MADE.test(column)) return 'date'
  if (CHANGED.test(column)) return 'updated'
  if (LABELS.test(column)) return 'tags'
  return propertyName(column)
}

/** Which of the CSVs to read. Notion writes `Table id.csv` for the view that was
 *  on screen and `Table id_all.csv` for every row; where both are there the
 *  second is the one that holds the database. */
function usefulCsvs(sources: readonly Source[]): Set<string> {
  const csvs = sources.filter((one) => CSV.test(one.path)).map((one) => one.path)
  const alls = new Set(
    csvs.filter((one) => /_all\.csv$/i.test(one)).map((one) => one.replace(/_all\.csv$/i, '')),
  )

  return new Set(csvs.filter((one) => /_all\.csv$/i.test(one) || !alls.has(one.replace(CSV, ''))))
}

/** A page's properties out of the lines under its title, and the words that are
 *  left.
 *
 *  What counts as the property block is the lines directly under the title, up to
 *  the first blank one, each of them `Name: value`. That is exactly where Notion
 *  writes them, and its export always leaves a blank line between the title and
 *  the page's own words - so a page that has no properties has a blank line there
 *  and nothing is taken from it. One line that is not a property makes the whole
 *  block words again, since half a block of properties is a page that has lost a
 *  sentence.
 *
 *  A row of a database read here is the exception, because Notion's export of
 *  one does leave a blank line under the title, and writes its properties after
 *  it: `# Dune`, a blank line, `Pages: 412`. There the columns are known, so the
 *  first block after the title is the row's properties when every line of it
 *  names one of them, and words otherwise. A column is known by its whole name,
 *  so one called `due date` or `📅 Due` is read as well as `Due` is. */
export function notionPage(
  text: string,
  kinds?: ReadonlyMap<string, Kind>,
): { body: string; meta: Meta } {
  const found = propertiesOf(text, kinds)
  if (!found) return { body: text, meta: {} }

  return { body: found.body, meta: metaOf(found.said, kinds) }
}

/** The property block of a page, as `notionPage` finds it, and the page without
 *  it. Null for a page that has none. */
function propertiesOf(
  text: string,
  kinds?: ReadonlyMap<string, Kind>,
): { said: [string, string][]; body: string } | null {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  let at = 0

  // The title is already the file's name, and nib keeps it as the heading.
  const title = lines[at]?.startsWith('# ') ? lines[at] : null
  if (title !== null) at += 1

  let found = blockAt(lines, at, kinds)
  if (!found && kinds && title !== null && !lines[at]?.trim()) {
    const after = blockAt(lines, at + 1, kinds)
    if (after?.said.every(([name]) => kinds.has(name))) found = after
  }
  if (!found) return null

  const body = [title, ...lines.slice(found.end)].filter((one) => one !== null).join('\n')
  return { said: found.said, body }
}

/** The lines from `at` up to the first blank one, when every one of them is a
 *  property, and where they end. */
function blockAt(
  lines: readonly string[],
  at: number,
  kinds?: ReadonlyMap<string, Kind>,
): { said: [string, string][]; end: number } | null {
  const said: [string, string][] = []
  let end = at

  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (!line.trim()) break

    const one = propertyIn(line, kinds)
    if (!one) return null

    said.push(one)
    end += 1
  }

  return said.length ? { said, end } : null
}

/** A line's property and its value: a column of the database by its whole name
 *  where the page is a row of one, and a name of the shape `PROPERTY` reads
 *  otherwise. */
function propertyIn(line: string, kinds?: ReadonlyMap<string, Kind>): [string, string] | null {
  let known = ''
  for (const name of kinds?.keys() ?? []) {
    if (name.length > known.length && line.startsWith(`${name}:`)) known = name
  }
  if (known) return [known, line.slice(known.length + 1).trim()]

  const found = PROPERTY.exec(line)
  return found ? [found[1] ?? '', found[2] ?? ''] : null
}

/** A page's properties as front matter: its own dates and labels under nib's
 *  names, and every other one as what its column holds. A page that is not a row
 *  of a database read here has its values judged one by one. */
function metaOf(said: readonly [string, string][], kinds?: ReadonlyMap<string, Kind>): Meta {
  const meta: Meta = {}
  const extra: [string, Property][] = []
  const tags: string[] = []

  for (const [name, value] of said) {
    const plain = value.trim()
    if (!plain) continue

    if (MADE.test(name)) {
      const day = dayOf(plain)
      if (day) meta.date ??= day
      continue
    }

    if (CHANGED.test(name)) {
      const day = dayOf(plain)
      if (day) meta.updated ??= day
      continue
    }

    if (LABELS.test(name)) {
      tags.push(...plain.split(',').map((one) => one.trim()))
      continue
    }

    extra.push([name, valueAs(kinds?.get(name) ?? kindOf([plain]), plain)])
  }

  if (tags.length) meta.tags = tags
  if (extra.length) meta.extra = extra
  return meta
}

/** An HTML export: the same tree of pages, each a web page rather than markdown.
 *  Its words are converted the way any HTML page is (see plain.ts), with the two
 *  things only Notion writes read first. A row's properties are a table at the
 *  top of its page, which become front matter as a Markdown export's lines do;
 *  and a to-do is a list item with a box drawn in front of it, which becomes a
 *  task, ticked or not. */
async function readNotionHtml(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  let pages = 0

  const plan = await folderPlan(sources, {
    format: 'notion',
    place: (source) => {
      if (isJunk(source.path) || isIndex(source.path)) return { to: null }

      const path = safeParts(source.path, withoutNotionId)
      if (!HTML.test(path)) return { to: names.free(path) }

      pages += 1
      return {
        to: names.free(path.replace(HTML, '.md')),
        read: (text) => {
          const said = notionHtml(text)
          return {
            text: htmlToMarkdown(said.html, { fileTargets: true, appTargets: true }),
            title: null,
            meta: said.meta,
          }
        },
      }
    },
  })

  // Said out loud because it is the one thing a reader of an HTML export has to
  // know: what the HTML did not hold was not in the export either.
  if (pages) {
    plan.lost.push({
      text: key('{count} pages came as HTML, so their words are kept and their look is not'),
      values: { count: pages },
    })
  }

  return plan
}

/** The box Notion draws in front of a to-do, ticked or not. */
const BOX = /<div class="checkbox checkbox-(on|off)"><\/div>(\s*<span class="to-do-children)?/g

/** A page of an HTML export, its properties table taken out as front matter and
 *  its to-dos made tasks. A box anywhere else, in a cell of a database's table,
 *  is the yes or no the Markdown export writes there. */
function notionHtml(text: string): { html: string; meta: Meta } {
  let html = text
  let meta: Meta = {}

  for (const tag of tagsIn(text)) {
    if (tag.closing || tag.name !== 'table' || !/\bproperties\b/.test(tag.attributes.class ?? ''))
      continue

    // A table nothing closes is a page cut short, whose words are all kept.
    const end = closingOf(text, 'table', tag.to)
    const close = text.indexOf('>', end)
    if (close === -1) break
    meta = propertiesTable(text.slice(tag.to, end))
    html = text.slice(0, tag.from) + text.slice(close + 1)
    break
  }

  const tasks = html.replace(BOX, (_, on: string, task: string | undefined) => {
    if (task === undefined) return on === 'on' ? 'Yes' : 'No'
    return `${on === 'on' ? '<input type="checkbox" checked>' : '<input type="checkbox">'}${task}`
  })
  return { html: tasks, meta }
}

/** The rows of a page's properties table as front matter. Each row says what
 *  kind of property it is in its class, so a value is written as that kind
 *  rather than judged from its words. */
function propertiesTable(table: string): Meta {
  const meta: Meta = {}
  const extra: [string, Property][] = []
  const tags: string[] = []

  for (const row of elements(table, 'tr')) {
    const type = /property-row-(\S+)/.exec(row.attributes.class ?? '')?.[1] ?? 'text'
    const name = words(elements(row.inner, 'th')[0]?.inner ?? '')
    const cell = elements(row.inner, 'td')[0]?.inner ?? ''
    if (!name) continue

    if (type === 'checkbox') {
      extra.push([name, cell.includes('checkbox-on')])
      continue
    }

    const labels = elements(cell, 'span')
      .filter((one) => /\bselected-value\b/.test(one.attributes.class ?? ''))
      .map((one) => words(one.inner))
      .filter(Boolean)
    const plain = words(cell).replace(/^@/, '')
    if (!plain) continue

    if (MADE.test(name) || CHANGED.test(name)) {
      const day = notionDate(plain)?.slice(0, 10) ?? dayOf(plain)
      if (day && MADE.test(name)) meta.date ??= day
      if (day && CHANGED.test(name)) meta.updated ??= day
      if (day) continue
    }

    if (LABELS.test(name)) {
      tags.push(...(labels.length ? labels : plain.split(',').map((one) => one.trim())))
      continue
    }

    if (type === 'multi_select' && labels.length) extra.push([name, labels])
    else if (labels.length) extra.push([name, labels.join(', ')])
    else if (type === 'date') extra.push([name, valueAs('date', plain)])
    else if (type === 'number') extra.push([name, valueAs('number', plain)])
    else extra.push([name, (type === 'relation' ? relationIn(cell) : null) ?? plain])
  }

  if (tags.length) meta.tags = tags
  if (extra.length) meta.extra = extra
  return meta
}

/** A relation's pages as links, by the names their notes have once the ids are
 *  off. Null when a link in it is not to a page of the export. */
function relationIn(cell: string): string[] | null {
  const links: string[] = []
  for (const one of elements(cell, 'a')) {
    const href = one.attributes.href ?? ''
    if (!HTML.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null
    let name = href.split('/').pop() ?? href
    try {
      name = decodeURIComponent(name)
    } catch {
      // A stray percent sign is a character of the name.
    }
    links.push(`[[${safeName(withoutNotionId(name.replace(HTML, '')))}]]`)
  }
  return links.length ? links : null
}

/** What some HTML says, as one line of words. */
function words(html: string): string {
  return unescapeXml(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
