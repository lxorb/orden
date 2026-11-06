import { foldName } from '@orden/markdown/links'

import { key } from '../i18n.svelte'
import { encodeTarget } from '../link-rewrite'
import { folderOf, relativePath } from '../space-paths'

import { folderPlan, isHidden, isJunk } from './folder'
import { dayOf, type Meta } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan } from './plan'
import type { Source } from './sources'

const APP = /^logseq\//i

const PROPERTY = /^\s*(?:-\s+)?([A-Za-z][\w -]{0,39}):: *(.*?)\r?$/

const MARKER =
  /^(\s*)-\s+(TODO|DOING|NOW|LATER|DONE|WAIT|WAITING|IN-PROGRESS|STARTED|CANCELED|CANCELLED)\s+/

const REFERENCE = /\(\(([0-9a-f-]{36})\)\)/gi

const LABELLED_REFERENCE = /\[([^\]\n]+)\]\(\(\(([0-9a-f-]{36})\)\)\)/gi

const BLOCK_EMBED = /\{\{embed\s+\(\(([0-9a-f-]{36})\)\)\s*\}\}/gi

const PAGE_EMBED = /\{\{embed\s+\[\[([^\]\n]+)\]\]\s*\}\}/gi

const LABELLED_PAGE = /\[([^\]\n]+)\]\(\[\[([^\]\n]+)\]\]\)/g

const PAGE = /\[\[([^\][\n]+)\]\]/g

const PICTURE_SIZE = /(!\[[^\]\n]*\]\([^)\n]*\))\{:[^}\n]*\}/g

const BLOCK_ID = /^\s*(?:-\s+)?id:: *([0-9a-f-]{36})\s*$/i

const COLLAPSED = /^\s*collapsed:: *(?:true|false)\s*$/i

const FENCE = /^\s*(?:-\s+)?(`{3,}|~{3,})/

const TITLE_FORMAT = 'MMM do, yyyy'
const FILE_FORMAT = 'yyyy_MM_dd'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Graph {
  blocks: ReadonlyMap<string, string>
  days: ReadonlyMap<string, string>
}

export async function readLogseq(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const root = graphRoot(sources)
  const inside = (path: string) => (path.startsWith(root) ? path.slice(root.length) : path)

  const config = await configOf(sources, root)
  const blocks = await blocksById(sources)
  const days = new Map<string, string>()
  for (const source of sources) {
    const day = journalOf(inside(source.path), config.file)
    if (day) days.set(journalTitle(day, config.title).toLowerCase(), day)
  }

  let flattened = 0
  const went = new Map<string, string>()

  const plan = await folderPlan(sources, {
    format: 'logseq',
    place: (source) => {
      const path = inside(source.path)
      if (isJunk(path) || isHidden(path) || APP.test(path)) return { to: null }

      const to = placed(path, config.file)
      const free = names.free(to)
      went.set(path, free)
      if (!/\.(md|markdown)$/i.test(to)) return { to: free }

      return {
        to: free,
        read: (text) => {
          const said = logseqNote(text, blocks, days)
          flattened += said.flattened

          const extra = said.meta.extra?.map(
            ([name, value]) =>
              [
                name,
                typeof value === 'string' ? followed(value, path, free, went) : value,
              ] as const,
          )

          const own = /^journals\//i.test(path) ? [] : [said.title ?? pageName(path)]
          const stem = foldName(to.replace(/\.[^./]+$/, ''))
          const aliases = [...own, ...said.aliases].filter((one, at, all) => {
            const name = foldName(one)
            return (
              name &&
              name !== stem &&
              !stem.endsWith(`/${name}`) &&
              all.findIndex((other) => foldName(other) === name) === at
            )
          })

          const meta = {
            ...said.meta,
            extra: [...(extra ?? []), ...(aliases.length ? [['aliases', aliases] as const] : [])],
          }
          return { text: said.body, title: null, meta, own: true }
        },
      }
    },
  })

  if (flattened) {
    plan.lost.push({
      text: key('{count} block references were written out as the words they pointed at'),
      values: { count: flattened },
    })
  }

  return plan
}

function followed(
  value: string,
  from: string,
  to: string,
  went: ReadonlyMap<string, string>,
): string {
  return value.replace(/\]\(([^)\n]+)\)/g, (whole, target: string) => {
    if (/^[a-z][\w+.-]*:/i.test(target) || target.startsWith('#')) return whole
    const there = went.get(within(folderOf(from), decoded(target.trim())) ?? '')
    return there ? `](${encodeTarget(relativePath(folderOf(to), there))})` : whole
  })
}

function within(folder: string, relative: string): string | null {
  const parts = folder ? folder.split('/') : []
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

function graphRoot(sources: readonly Source[]): string {
  const paths = sources.map((one) => one.path)
  if (paths.some((one) => /^(logseq|pages|journals)\//i.test(one))) return ''

  for (const path of paths) {
    const found = /^([^/]+\/)(?:logseq|pages)\//i.exec(path)
    if (found?.[1]) return found[1]
  }

  return ''
}

async function configOf(
  sources: readonly Source[],
  root: string,
): Promise<{ title: string; file: string }> {
  const config = sources.find(
    (one) => one.path.toLowerCase() === `${root}logseq/config.edn`.toLowerCase(),
  )
  const text = config ? await config.text() : ''
  const setting = (name: string) =>
    new RegExp(`^[ \\t{]*:journal/${name}\\s+"\\s*([^"\\s][^"\\n]*?)\\s*"`, 'm').exec(text)?.[1]

  return {
    title: setting('page-title-format') ?? TITLE_FORMAT,
    file: setting('file-name-format') ?? FILE_FORMAT,
  }
}

function journalOf(path: string, format: string): string | null {
  const name = /^journals\/([^/]+)\.(md|markdown)$/i.exec(path)?.[1]
  if (!name) return null
  return dayIn(name, format) ?? dayOf(name.replace(/_/g, '-'))
}

function dayIn(name: string, format: string): string | null {
  const order: string[] = []
  const pattern = format.replace(/yyyy|MM|M|dd|d|[^yMd]/g, (token) => {
    const which =
      token === 'yyyy' ? 'y' : token.startsWith('M') ? 'm' : token.startsWith('d') ? 'd' : ''
    if (!which) return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    order.push(which)
    return which === 'y' ? '(\\d{4})' : '(\\d{1,2})'
  })
  if (order.length !== 3) return null

  const found = new RegExp(`^${pattern}$`).exec(name)
  if (!found) return null
  const part = (which: string) => found[order.indexOf(which) + 1] ?? ''
  return dayOf(`${part('y')}-${part('m').padStart(2, '0')}-${part('d').padStart(2, '0')}`)
}

function journalTitle(day: string, format: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()] ?? ''
  const monthName = MONTHS[month - 1] ?? ''
  const two = (value: number) => String(value).padStart(2, '0')

  return format.replace(/yyyy|yy|MMMM|MMM|MM|M|EEEE|EEE|EE|E|do|dd|d/g, (token) => {
    switch (token) {
      case 'yyyy':
        return String(year)
      case 'yy':
        return two(year % 100)
      case 'MMMM':
        return monthName
      case 'MMM':
        return monthName.slice(0, 3)
      case 'MM':
        return two(month)
      case 'M':
        return String(month)
      case 'EEEE':
        return weekday
      case 'do':
        return ordinal(date)
      case 'dd':
        return two(date)
      case 'd':
        return String(date)
      default:
        return weekday.slice(0, 3)
    }
  })
}

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

function pageName(path: string): string {
  const name = (/^pages\/(.+)$/i.exec(path)?.[1] ?? path).replace(/\.[^./]+$/, '')
  return decoded(name.split('___').join('/'))
}

function decoded(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function placed(path: string, format: string): string {
  if (/^journals\/.+\.(md|markdown)$/i.test(path)) {
    const name = /^journals\/(.+)\.(md|markdown)$/i.exec(path)?.[1] ?? ''
    return `Journals/${journalOf(path, format) ?? safeName(name)}.md`
  }

  const page = /^pages\/(.+)$/i.exec(path)
  const rest = page ? (page[1] ?? path) : path
  const extension = /\.[^./]+$/.exec(rest)?.[0] ?? ''
  const stem = rest.slice(0, rest.length - extension.length)

  const parts = stem
    .split('/')
    .flatMap((one) => (page ? decoded(one) : one).split(/___|\//))
    .filter((one) => one.trim())
  return `${(parts.length ? parts : ['']).map((one) => safeName(one)).join('/')}${extension}`
}

function fenced(lines: readonly string[]): boolean[] {
  let open: string | null = null
  return lines.map((line) => {
    const fence = FENCE.exec(line)?.[1]
    if (open === null) {
      if (fence) open = fence
      return open !== null
    }
    if (fence?.startsWith(open.slice(0, 1)) && fence.length >= open.length) open = null
    return true
  })
}

async function blocksById(sources: readonly Source[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  for (const source of sources) {
    if (!/\.(md|markdown)$/i.test(source.path)) continue

    const lines = (await source.text()).split('\n')
    const code = fenced(lines)
    for (const [at, line] of lines.entries()) {
      if (code[at]) continue
      const id = BLOCK_ID.exec(line)?.[1]?.toLowerCase()
      if (!id) continue

      for (let back = at - 1; back >= 0; back -= 1) {
        const said = (lines[back] ?? '').replace(/^\s*-\s+/, '').trim()
        if (!said || PROPERTY.test(said)) continue
        found.set(id, said)
        break
      }
    }
  }

  return found
}

function namesIn(value: string): string[] {
  return value
    .split(',')
    .map((one) =>
      one
        .trim()
        .replace(/^#?\[\[(.*)\]\]$/, '$1')
        .replace(/^#/, '')
        .trim(),
    )
    .filter(Boolean)
}

export function logseqNote(
  text: string,
  blocks: ReadonlyMap<string, string> = new Map(),
  days: ReadonlyMap<string, string> = new Map(),
): { body: string; meta: Meta; flattened: number; title: string | null; aliases: string[] } {
  const graph: Graph = { blocks, days }
  const lines = text.split('\n')
  const said: [string, string][] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] ?? ''
    if (!line.trim()) {
      at += 1
      continue
    }

    const found = PROPERTY.exec(line)
    if (!found) break

    said.push([found[1] ?? '', (found[2] ?? '').trim()])
    at += 1
  }

  const meta: Meta = {}
  const extra: [string, string][] = []
  const tags: string[] = []
  const aliases: string[] = []
  let title: string | null = null
  let flattened = 0
  const count = () => (flattened += 1)

  for (const [name, value] of said) {
    if (!value) continue

    if (/^tags?$/i.test(name)) {
      tags.push(...namesIn(value))
      continue
    }

    if (/^alias(es)?$/i.test(name)) {
      aliases.push(...namesIn(value))
      continue
    }

    if (/^(created-at|date)$/i.test(name)) {
      const day = dayOf(value)
      if (day && !meta.date) {
        meta.date = day
        continue
      }
    }

    if (/^(id|collapsed|heading|filters)$/i.test(name)) continue

    if (/^title$/i.test(name)) title = value

    extra.push([name, logseqText(value, graph, count)])
  }

  if (tags.length) meta.tags = tags
  if (extra.length) meta.extra = extra

  const rest = blocksOf(lines.slice(at))
  const code = fenced(rest)
  const body = rest
    .flatMap((line, index) => {
      if (code[index]) return [line]
      if (BLOCK_ID.test(line) || COLLAPSED.test(line)) return []
      return [logseqLine(line, graph, count)]
    })
    .join('\n')

  return { body, meta, flattened, title, aliases }
}

const CODE_BLOCKS = ['SRC', 'EXAMPLE', 'QUERY']
const CODE_LANGUAGE: Record<string, string> = { EXAMPLE: '', QUERY: 'clojure' }

function blocksOf(lines: readonly string[]): string[] {
  const code = fenced(lines)
  const out: string[] = []
  let open: { kind: string; inside: string } | null = null
  let drawer = false

  for (const [at, line] of lines.entries()) {
    if (code[at]) {
      out.push(line)
      continue
    }

    if (drawer) {
      if (/^\s*:END:\s*$/i.test(line)) drawer = false
      continue
    }
    const closed = (end: RegExp) => lines.slice(at + 1).some((later) => end.test(later))

    if (/^\s*(?:-\s+)?:LOGBOOK:\s*$/i.test(line) && closed(/^\s*:END:\s*$/i)) {
      drawer = true
      continue
    }

    if (open) {
      if (new RegExp(`^\\s*#\\+END_${open.kind}\\s*$`, 'i').test(line)) {
        if (CODE_BLOCKS.includes(open.kind)) out.push(`${open.inside}\`\`\``)
        open = null
        continue
      }
      const words = line.startsWith(open.inside) ? line.slice(open.inside.length) : line.trimStart()
      out.push(
        CODE_BLOCKS.includes(open.kind)
          ? `${open.inside}${words}`
          : `${open.inside}> ${words}`.trimEnd(),
      )
      continue
    }

    const begin = /^(\s*(?:-\s+)?)#\+BEGIN_(\w+)(?:[ \t]+(.*?))?\s*$/i.exec(line)
    const kind = begin?.[2]?.toUpperCase() ?? ''
    const callout = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'PINNED'].includes(kind)
    if (
      begin &&
      (callout || kind === 'QUOTE' || CODE_BLOCKS.includes(kind)) &&
      closed(new RegExp(`^\\s*#\\+END_${kind}\\s*$`, 'i'))
    ) {
      const lead = begin[1] ?? ''
      const inside = lead.replace(/-(\s+)$/, ' $1')
      open = { kind, inside }
      const bullet = lead.includes('-')
      if (!bullet && !CODE_BLOCKS.includes(kind) && out.at(-1)?.trimStart().startsWith('>'))
        out.push('')
      if (callout) out.push(`${lead}> [!${kind.toLowerCase()}]`)
      else if (kind === 'QUOTE') out.push(`${lead}>`)
      else out.push(`${lead}\`\`\`${CODE_LANGUAGE[kind] ?? (begin[3] ?? '').split(/\s/)[0]}`)
      continue
    }

    out.push(line)
  }

  return out
}

function logseqLine(line: string, graph: Graph, count: () => void): string {
  return logseqText(
    line.replace(MARKER, (_whole, indent: string, word: string) =>
      word === 'DONE' ? `${indent}- [x] ` : `${indent}- [ ] `,
    ),
    graph,
    count,
  )
}

function logseqText(text: string, graph: Graph, count: () => void): string {
  const block = (whole: string, id: string, as: (said: string) => string = (said) => said) => {
    const said = graph.blocks.get(id.toLowerCase())
    if (said === undefined) return whole
    count()
    return as(said)
  }
  const page = (name: string) => graph.days.get(name.trim().toLowerCase()) ?? name

  return text
    .replace(LABELLED_REFERENCE, (whole, words: string, id: string) =>
      block(whole, id, () => words),
    )
    .replace(BLOCK_EMBED, (whole, id: string) => block(whole, id))
    .replace(REFERENCE, (whole, id: string) => block(whole, id))
    .replace(PAGE_EMBED, (_whole, name: string) => `![[${page(name)}]]`)
    .replace(LABELLED_PAGE, (_whole, words: string, name: string) => `[[${page(name)}|${words}]]`)
    .replace(PAGE, (_whole, name: string) => `[[${page(name)}]]`)
    .replace(PICTURE_SIZE, '$1')
}
