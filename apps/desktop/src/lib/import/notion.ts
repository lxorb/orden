import { htmlToMarkdown } from '@orden/markdown/from-html'

import { key } from '../i18n.svelte'
import { folderPlan, isJunk } from './folder'
import { dayOf, freeKey, type Meta, noteText, propertyName, type Property } from './meta'
import { hasNotionId, Names, safeName, safeParts, withoutNotionId } from './names'
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

const PROPERTY = /^([A-Z][^:\n.]{0,39}): *(.*)$/

const MADE = /^(created|created time|created at|date)$/i
const CHANGED = /^(last edited time|last edited|last modified|updated)$/i
const LABELS = /^(tags?|multi-select|select|labels?)$/i

export async function readNotion(exported: readonly Source[]): Promise<ImportPlan> {
  const sources = unwrapped(exported)
  const html = sources.filter((one) => HTML.test(one.path)).length
  const markdown = sources.filter((one) => MARKDOWN.test(one.path)).length

  if (html > markdown) return readNotionHtml(sources)

  const names = new Names()
  const kept = usefulCsvs(sources)
  const paths = new Set(sources.map((one) => one.path))
  let views = 0

  const databases = new Map<string, Database>()
  const folders = rowFolders(sources, kept)
  const folderOf = (csv: string) => folders.get(csv) ?? csv.replace(/(_all)?\.csv$/i, '')
  for (const source of sources) {
    if (kept.has(source.path)) databases.set(folderOf(source.path), databaseOf(await source.text()))
  }
  const placed = new Map<string, string>()

  const plan = await folderPlan(sources, {
    format: 'notion',
    place: (source) => {
      if (isJunk(source.path) || isIndex(source.path)) return { to: null }

      if (isTable(source.path)) {
        if (!kept.has(source.path)) {
          views += 1
          return { to: null }
        }

        const path = names.free(
          `${safeParts(`${folderOf(source.path)}/-`, withoutNotionId).slice(0, -2)}.md`,
        )
        const database = databases.get(folderOf(source.path))
        if (database) placed.set(folderOf(source.path), path)
        return {
          to: path,
          read: () => {
            const name = (path.split('/').pop() ?? path).replace(MARKDOWN, '')
            if (!database) return { text: '', title: name }
            const keys = keysOf(database)
            return { text: baseBlock(database, (one) => keys.get(one) ?? ''), title: name }
          },
        }
      }

      if (!MARKDOWN.test(source.path))
        return { to: names.free(safeParts(source.path, withoutNotionId)) }

      const database = databases.get(parentOf(source.path))
      return {
        to: names.free(safeParts(source.path, withoutNotionId)),
        read: (text) => {
          const said = notionPage(text, database?.kinds, database && keysOf(database))
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
      one: '{count} saved view is left out, and every row is in the table',
      values: { count: views },
    })
  }

  return plan
}

const NAMED = /^(.*) ([0-9a-f]{32})$/i

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

const WRAPPER = /^Export-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:-Part-\d+)?\//i

function unwrapped(sources: readonly Source[]): readonly Source[] {
  const wrapped = sources.filter((one) => !isJunk(one.path))
  if (!wrapped.length || !wrapped.every((one) => WRAPPER.test(one.path))) return sources

  return sources.map((one) => ({
    path: one.path.replace(WRAPPER, ''),
    text: () => one.text(),
    bytes: () => one.bytes(),
  }))
}

function isIndex(path: string): boolean {
  return /^index\.html$/i.test(path)
}

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
      text: noteText(name, '', metaOf(said, database.kinds, keysOf(database))),
    })
  }

  return out
}

function matchable(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function keysOf(database: Database): Map<string, string> {
  const columns = database.columns.slice(1)
  const keys = new Map<string, string>()
  const taken = new Set<string>(['date', 'updated'])

  for (const column of columns) {
    if (LABELS.test(column)) keys.set(column, 'tags')
  }
  if (keys.size) taken.add('tags')

  for (const [kind, own] of [
    [MADE, 'date'],
    [CHANGED, 'updated'],
  ] as const) {
    const days = [...columns]
      .sort((one, two) => Number(/^created/i.test(two)) - Number(/^created/i.test(one)))
      .find((column) => kind.test(column) && readsAsDays(database, column))
    if (days) keys.set(days, own)
  }

  for (const [at, column] of columns.entries()) {
    if (keys.has(column)) continue
    const own = MADE.test(column) ? 'date' : CHANGED.test(column) ? 'updated' : null
    keys.set(column, freeKey(own ?? (propertyName(column) || `column-${at + 2}`), taken))
  }

  return keys
}

function readsAsDays(database: Database, column: string): boolean {
  const said = database.rows.map((row) => (row[column] ?? '').trim()).filter(Boolean)
  return said.length > 0 && said.every((one) => dayOf(one) !== null)
}

function isTable(path: string): boolean {
  const name = (path.split('/').pop() ?? path).replace(/_all(\.csv)$/i, '$1')
  return CSV.test(name) && hasNotionId(name)
}

function usefulCsvs(sources: readonly Source[]): Set<string> {
  const csvs = sources.filter((one) => isTable(one.path)).map((one) => one.path)
  const alls = new Set(
    csvs.filter((one) => /_all\.csv$/i.test(one)).map((one) => one.replace(/_all\.csv$/i, '')),
  )

  return new Set(csvs.filter((one) => /_all\.csv$/i.test(one) || !alls.has(one.replace(CSV, ''))))
}

export function notionPage(
  text: string,
  kinds?: ReadonlyMap<string, Kind>,
  keys?: ReadonlyMap<string, string>,
): { body: string; meta: Meta } {
  const found = propertiesOf(text, kinds)
  if (!found) return { body: text, meta: {} }

  return { body: found.body, meta: metaOf(found.said, kinds, keys) }
}

function propertiesOf(
  text: string,
  kinds?: ReadonlyMap<string, Kind>,
): { said: [string, string][]; body: string } | null {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  let at = 0

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

function propertyIn(line: string, kinds?: ReadonlyMap<string, Kind>): [string, string] | null {
  let known = ''
  for (const name of kinds?.keys() ?? []) {
    if (name.length > known.length && line.startsWith(`${name}:`)) known = name
  }
  if (known) return [known, line.slice(known.length + 1).trim()]

  const found = PROPERTY.exec(line)
  return found ? [found[1] ?? '', found[2] ?? ''] : null
}

function metaOf(
  said: readonly [string, string][],
  kinds?: ReadonlyMap<string, Kind>,
  keys?: ReadonlyMap<string, string>,
): Meta {
  const meta: Meta = {}
  const extra: [string, Property][] = []
  const tags: string[] = []

  for (const [name, value] of said) {
    const plain = value.trim()
    if (!plain) continue
    const key = keys?.get(name)

    if (MADE.test(name) && !meta.date && (key ?? 'date') === 'date') {
      const day = dayOf(plain)
      if (day) {
        meta.date = day
        continue
      }
    }

    if (CHANGED.test(name) && !meta.updated && (key ?? 'updated') === 'updated') {
      const day = dayOf(plain)
      if (day) {
        meta.updated = day
        continue
      }
    }

    if (LABELS.test(name)) {
      tags.push(...plain.split(',').map((one) => one.trim()))
      continue
    }

    extra.push([key ?? name, valueAs(kinds?.get(name) ?? kindOf([plain]), plain)])
  }

  if (tags.length) meta.tags = tags
  if (extra.length) meta.extra = extra
  return meta
}

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
            text: htmlToMarkdown(said.html, {
              fileTargets: true,
              appTargets: true,
              mediaLinks: true,
              plainTasks: true,
            }),
            title: null,
            meta: said.meta,
          }
        },
      }
    },
  })

  if (pages) {
    plan.lost.push({
      text: key('{count} pages came as HTML, so their words are kept and their look is not'),
      values: { count: pages },
    })
  }

  return plan
}

const BOX = /<div class="checkbox checkbox-(on|off)"><\/div>(\s*<span class="to-do-children)?/g

function notionHtml(text: string): { html: string; meta: Meta } {
  let html = text
  let meta: Meta = {}

  for (const tag of tagsIn(text)) {
    if (tag.closing || tag.name !== 'table' || !/\bproperties\b/.test(tag.attributes.class ?? ''))
      continue

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
      if (day && MADE.test(name) && !meta.date) {
        meta.date = day
        continue
      }
      if (day && CHANGED.test(name) && !meta.updated) {
        meta.updated = day
        continue
      }
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

function words(html: string): string {
  return unescapeXml(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
