/** A Logseq graph.
 *
 *  A graph is a folder: `pages/` for the notes somebody named, `journals/` for the
 *  ones the date named, `assets/` for the files, and `logseq/` for the app's own
 *  settings, which are not notes and do not come. A graph zipped up arrives one
 *  folder down, `My graph/pages/`, and is read the same.
 *
 *  Three things are Logseq's own:
 *
 *  `key:: value` at the top of a note is a property, which becomes front matter -
 *  that is where nib keeps a note's properties and what `[key:value]` searches.
 *  `alias::` is the other names a page answers to, which nib calls `aliases`.
 *
 *  `((a-uuid))` is a reference to one block somewhere else in the graph. nib has
 *  block links of its own, but they point at a block in one note by a name that
 *  note carries, and a Logseq uuid is not that name. So a reference is replaced
 *  with what the block said, which is what the reader was looking at anyway, and
 *  the count is said out loud. A reference to a block nothing exported is left as
 *  it was written rather than emptied. An embed of a block, `{{embed ((uuid))}}`,
 *  is the same words, and a reference with words of its own, `[these](((uuid)))`,
 *  is those words. An embed of a page, `{{embed [[Page]]}}`, is nib's `![[Page]]`.
 *
 *  `TODO`, `DOING`, `NOW`, `LATER` and `DONE` in front of a bullet are Logseq's
 *  task markers, as are the rarer `WAITING` and its kin, and they become task list
 *  items: a box is a box.
 *
 *  A journal is renamed to the date it is: `2026_09_11.md` is `2026-09-11.md`, so
 *  a year of them sorts in the file list. A link to one names it the way Logseq
 *  showed it, `[[Sep 11th, 2026]]`, and is pointed at the date it is now. Both
 *  shapes are read from the graph's own settings, where somebody may have changed
 *  them.
 *
 *  A page is a file named after it, with what a file name cannot hold written
 *  another way: `a___b.md` is the page `a/b`, and `What%3F.md` is `What?`. A page
 *  whose name the import could not keep as its file name, or that named itself with
 *  `title::`, answers to that name as an alias, so the links to it still find it. */

import { foldName } from '@nib/markdown/links'

import { key } from '../i18n.svelte'
import { encodeTarget } from '../link-rewrite'
import { folderOf, relativePath } from '../space-paths'

import { folderPlan, isHidden, isJunk } from './folder'
import { dayOf, type Meta } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan } from './plan'
import type { Source } from './sources'

/** Logseq's own folder, which holds its settings and its caches. */
const APP = /^logseq\//i

/** A property line: `key:: value`, at the top of a note or of its first block. */
const PROPERTY = /^\s*(?:-\s+)?([A-Za-z][\w -]{0,39}):: *(.*?)\r?$/

/** The words Logseq puts in front of a bullet to make it a task. */
const MARKER =
  /^(\s*)-\s+(TODO|DOING|NOW|LATER|DONE|WAIT|WAITING|IN-PROGRESS|STARTED|CANCELED|CANCELLED)\s+/

/** A block reference. */
const REFERENCE = /\(\(([0-9a-f-]{36})\)\)/gi

/** A block reference with words of its own: `[these words](((uuid)))`. */
const LABELLED_REFERENCE = /\[([^\]\n]+)\]\(\(\(([0-9a-f-]{36})\)\)\)/gi

/** A block shown in place: `{{embed ((uuid))}}`. */
const BLOCK_EMBED = /\{\{embed\s+\(\(([0-9a-f-]{36})\)\)\s*\}\}/gi

/** A page shown in place: `{{embed [[Page]]}}`. */
const PAGE_EMBED = /\{\{embed\s+\[\[([^\]\n]+)\]\]\s*\}\}/gi

/** A page reference with words of its own: `[these words]([[Page]])`. */
const LABELLED_PAGE = /\[([^\]\n]+)\]\(\[\[([^\]\n]+)\]\]\)/g

/** A page reference. */
const PAGE = /\[\[([^\][\n]+)\]\]/g

/** The size Logseq writes after a picture, `{:height 53, :width 42}`, which a
 *  markdown picture has no place for and every other reader shows as words. */
const PICTURE_SIZE = /(!\[[^\]\n]*\]\([^)\n]*\))\{:[^}\n]*\}/g

/** The id a block carries so others can point at it. */
const BLOCK_ID = /^\s*(?:-\s+)?id:: *([0-9a-f-]{36})\s*$/i

/** Whether a block is folded on screen, which is Logseq's business and not words. */
const COLLAPSED = /^\s*collapsed:: *(?:true|false)\s*$/i

/** A line that opens or closes a fenced code block, bullet or not. */
const FENCE = /^\s*(?:-\s+)?(`{3,}|~{3,})/

/** How Logseq names a journal's page and its file when nobody changed either. */
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

/** What the rest of the graph knows that one note needs. */
interface Graph {
  /** What every block that carries an id says. */
  blocks: ReadonlyMap<string, string>
  /** The date each journal is now, by the name Logseq gave its page, in lower case. */
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
  // Where each file of the graph went, by its path in the graph.
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

          // The import follows the links in a note's words to where their files
          // went, and these are the ones in its properties: a PDF's highlights
          // page names its PDF there.
          const extra = said.meta.extra?.map(
            ([name, value]) =>
              [
                name,
                typeof value === 'string' ? followed(value, path, free, went) : value,
              ] as const,
          )

          // The names the page answered to in Logseq that its file here does not
          // say, so a link written with one of them still finds it.
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
          return { text: said.body, title: null, meta }
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

/** A property's links to files of the graph, written in the note at `from` in the
 *  graph and now at `to`, pointed at where those files went. A link to anything
 *  else is left as it was. */
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

/** A relative path read from a folder of the graph, or null for one that leaves it. */
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

/** Where the graph starts: the top, or one folder down for a graph zipped up
 *  whole, which is as far as the import looks for one. */
function graphRoot(sources: readonly Source[]): string {
  const paths = sources.map((one) => one.path)
  if (paths.some((one) => /^(logseq|pages|journals)\//i.test(one))) return ''

  for (const path of paths) {
    const found = /^([^/]+\/)(?:logseq|pages)\//i.exec(path)
    if (found?.[1]) return found[1]
  }

  return ''
}

/** How this graph names its journals, out of its `config.edn`. */
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

/** The day a journal is, from its path in the graph, or null for anything else. */
function journalOf(path: string, format: string): string | null {
  const name = /^journals\/([^/]+)\.(md|markdown)$/i.exec(path)?.[1]
  if (!name) return null
  return dayIn(name, format) ?? dayOf(name.replace(/_/g, '-'))
}

/** A day out of a name written in one of Logseq's date formats, the numbers in it
 *  read by where the format puts them. */
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

/** A journal's page name in Logseq, `YYYY-MM-DD` written in the graph's format. */
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

/** The name a page had in Logseq, out of its path: `pages/a___b.md` is `a/b`. */
function pageName(path: string): string {
  const name = (/^pages\/(.+)$/i.exec(path)?.[1] ?? path).replace(/\.[^./]+$/, '')
  return decoded(name.split('___').join('/'))
}

/** A file name's percent encoding undone, where it is encoding at all. */
function decoded(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** Where a file of the graph goes. Journals keep their folder and gain their
 *  proper name; everything else keeps the shape it had, minus the `pages/` that
 *  only said "this is a page". */
function placed(path: string, format: string): string {
  if (/^journals\/.+\.(md|markdown)$/i.test(path)) {
    const name = /^journals\/(.+)\.(md|markdown)$/i.exec(path)?.[1] ?? ''
    return `Journals/${journalOf(path, format) ?? safeName(name)}.md`
  }

  const page = /^pages\/(.+)$/i.exec(path)
  const rest = page ? (page[1] ?? path) : path
  const extension = /\.[^./]+$/.exec(rest)?.[0] ?? ''
  const stem = rest.slice(0, rest.length - extension.length)

  // A page whose name held a slash is written with three underscores, since the
  // name has to be a file name: `a___b.md` is the page `a/b`, which is a folder
  // and a note here. What else a file name cannot hold is percent encoded, and an
  // older graph wrote its slash that way too. Every part is argued with on its
  // own, so the folders an export arranged stay folders, and the extension is put
  // back after, so a long name is shortened rather than its `.md`. A name that
  // ended in a slash has nothing after its last one, which says nothing.
  const parts = stem
    .split('/')
    .flatMap((one) => (page ? decoded(one) : one).split(/___|\//))
    .filter((one) => one.trim())
  return `${(parts.length ? parts : ['']).map((one) => safeName(one)).join('/')}${extension}`
}

/** Which lines of a note are inside a fenced code block, fences included, where
 *  nothing is Logseq's syntax and everything is kept exactly as written. */
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

/** What every block that carries an id says, so a reference to it can be written
 *  out in full. */
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

      // The block is the line above the id, which is where Logseq writes it.
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

/** A property's value as the names in it: `[[a]], b, #c` is `a`, `b` and `c`. */
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

/** A note's properties, its words, and how many references were written out.
 *  `title` and `aliases` are the names the page gave itself. */
export function logseqNote(
  text: string,
  blocks: ReadonlyMap<string, string> = new Map(),
  days: ReadonlyMap<string, string> = new Map(),
): { body: string; meta: Meta; flattened: number; title: string | null; aliases: string[] } {
  const graph: Graph = { blocks, days }
  const lines = text.split('\n')
  const said: [string, string][] = []
  let at = 0

  // The properties are the first lines of the file, before anything else.
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
      if (day) {
        meta.date ??= day
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

/** The Org mode blocks that hold code: source, an example, and a query, which is
 *  Datalog that only Logseq can run and is kept to read. */
const CODE_BLOCKS = ['SRC', 'EXAMPLE', 'QUERY']
const CODE_LANGUAGE: Record<string, string> = { EXAMPLE: '', QUERY: 'clojure' }

/** The blocks Logseq borrowed from Org mode, `#+BEGIN_NOTE` to `#+END_NOTE`, in the
 *  spellings everything else reads: a quote is a quote, a note or a warning is a
 *  callout of that kind, and source code or a query is a fenced code block. One nib has no
 *  spelling for is left as it was written. And the clock Logseq keeps on a task in
 *  a `:LOGBOOK:` drawer is its own bookkeeping, which does not come. */
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
    // Only a block that is closed somewhere below is one; anything else is words.
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
      // A quote straight after another would be read as more of it.
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

/** One line of a note in the spellings everything else reads. */
function logseqLine(line: string, graph: Graph, count: () => void): string {
  return logseqText(
    line.replace(MARKER, (_whole, indent: string, word: string) =>
      word === 'DONE' ? `${indent}- [x] ` : `${indent}- [ ] `,
    ),
    graph,
    count,
  )
}

/** Logseq's references and embeds, in the spellings everything else reads. */
function logseqText(text: string, graph: Graph, count: () => void): string {
  const block = (whole: string, id: string, as: (said: string) => string = (said) => said) => {
    const said = graph.blocks.get(id.toLowerCase())
    if (said === undefined) return whole
    count()
    return as(said)
  }
  // A journal is named by its date now, so a link to it says that date.
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
