import { foldName } from '@orden/markdown/links'
import { asWords } from '@orden/markdown/words'

import { dayOf, noteText, type Meta } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan, Planned } from './plan'
import type { Source } from './sources'

const JOURNALS = 'Journals'

const DAY =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th),\s+(\d{4})$/

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const EMBED = String.raw`\{\{\s*(?:\[\[)?embed(?:-path)?(?:\]\])?\s*:\s*`

const BLOCK_EMBED = new RegExp(`${EMBED}\\(\\(([^()\\s]+)\\)\\)\\s*\\}\\}`, 'g')

const ALONE = new RegExp(`^\\s*${BLOCK_EMBED.source}\\s*$`)

const PAGE_EMBED = new RegExp(`${EMBED}\\[\\[([^\\]\\n]+)\\]\\]\\s*\\}\\}`, 'g')

interface RoamBlock {
  string?: unknown
  uid?: unknown
  children?: unknown
  heading?: unknown
}

interface RoamPage extends RoamBlock {
  title?: unknown
  'create-time'?: unknown
  'edit-time'?: unknown
}

interface Graph {
  known: ReadonlyMap<string, string>
  under: ReadonlyMap<string, unknown>
  counted: () => void
}

export async function readRoam(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const written: Planned[] = []
  const lost: string[] = []
  let flattened = 0

  for (const source of sources) {
    if (!/\.json$/i.test(source.path)) continue

    const pages = asPages(await source.text())
    if (!pages) continue

    const graph: Graph = { ...blocksIn(pages), counted: () => (flattened += 1) }

    for (const page of pages) {
      const said = typeof page.title === 'string' ? page.title.trim() : ''
      if (!said) continue

      const day = dayName(said)
      const parts = said.split('/').filter((one) => one.trim())
      const path = day
        ? `${JOURNALS}/${day}`
        : (parts.length ? parts : ['']).map((one) => safeName(one)).join('/')
      const title = path.split('/').pop() ?? path

      const body = linesOf(page.children, 0, graph, new Set()).join('\n')

      const meta: Meta = {}
      const made = dayOf(asNumber(page['create-time']))
      const changed = dayOf(asNumber(page['edit-time']))
      if (made) meta.date = made
      if (changed) meta.updated = changed
      if (!day && foldName(said) !== foldName(path)) meta.extra = [['aliases', [said]]]

      written.push({
        kind: 'note',
        path: names.free(`${path}.md`),
        text: noteText(title, body, meta),
      })
    }
  }

  if (flattened) {
    lost.push(`${flattened} block references were written out as the words they pointed at`)
  }

  return { format: 'roam', files: written, lost }
}

function asPages(text: string): RoamPage[] | null {
  try {
    const said: unknown = JSON.parse(text)
    if (!Array.isArray(said)) return null

    const pages = said.filter(
      (one): one is RoamPage => !!one && typeof one === 'object' && 'title' in one,
    )

    return pages.length ? pages : null
  } catch {
    return null
  }
}

function blocksIn(pages: readonly RoamPage[]): Pick<Graph, 'known' | 'under'> {
  const known = new Map<string, string>()
  const under = new Map<string, unknown>()

  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return

    for (const one of blocks) {
      if (!one || typeof one !== 'object') continue
      const block = one as RoamBlock
      const uid = typeof block.uid === 'string' ? block.uid : ''
      const said = typeof block.string === 'string' ? block.string : ''
      if (uid && said) known.set(uid, said)
      if (uid && block.children) under.set(uid, block.children)
      walk(block.children)
    }
  }

  for (const page of pages) walk(page.children)
  return { known, under }
}

function linesOf(
  blocks: unknown,
  depth: number,
  graph: Graph,
  embedding: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(blocks)) return []

  const out: string[] = []

  for (const one of blocks) {
    if (!one || typeof one !== 'object') continue

    const block = one as RoamBlock
    const said = typeof block.string === 'string' ? block.string : ''
    const uid = typeof block.uid === 'string' ? block.uid : ''
    const here = uid ? new Set([...embedding, uid]) : embedding

    const embedded = ALONE.exec(said)?.[1]
    const shown = embedded && graph.known.has(embedded) && !here.has(embedded) ? embedded : null
    const words = roamText(said, graph.known, graph.counted, new Set(uid ? [uid] : []))
    const indent = '  '.repeat(depth)

    const heading = depth === 0 && typeof block.heading === 'number' ? block.heading : 0
    let next = depth
    if (words.trim()) {
      if (heading >= 1 && heading <= 6) {
        if (out.length && out.at(-1) !== '') out.push('')
        out.push(`${'#'.repeat(heading)} ${words}`, '')
      } else {
        out.push(`${indent}- ${itemText(words, `${indent}  `)}`)
        next = depth + 1
      }
    }

    if (shown) {
      for (const line of linesOf(graph.under.get(shown), next, graph, new Set([...here, shown]))) {
        out.push(line)
      }
    }
    for (const line of linesOf(block.children, next, graph, here)) out.push(line)
  }

  return out
}

function itemText(words: string, indent: string): string {
  const fenced = words.replace(/^(\s*```[^\n]*\n[\s\S]*?[^\n])```\s*$/, '$1\n```')
  return fenced
    .split('\n')
    .map((line, at) => (at && line.trim() ? `${indent}${line}` : line))
    .join('\n')
}

export function roamText(
  said: string,
  known: ReadonlyMap<string, string> = new Map(),
  counted: () => void = () => undefined,
  showing: ReadonlySet<string> = new Set(),
): string {
  const block = (whole: string, uid: string, as?: () => string) => {
    const words = known.get(uid)
    if (words === undefined || showing.has(uid)) return whole
    counted()
    return as ? as() : roamText(words, known, counted, new Set([...showing, uid]))
  }
  const page = (name: string) => dayName(name.trim()) ?? name

  return outsideCode(said, (text) =>
    asWords(text)
      .replace(/\{\{(?:\[\[)?TODO(?:\]\])?\}\}\s*/g, '[ ] ')
      .replace(/\{\{(?:\[\[)?DONE(?:\]\])?\}\}\s*/g, '[x] ')
      .replace(/\^\^([^^]+)\^\^/g, '==$1==')
      .replace(/(?<![\w_])__(?=\S)([^_\n]+?)__(?![\w_])/g, '*$1*')
      .replace(BLOCK_EMBED, (whole, uid: string) => block(whole, uid))
      .replace(PAGE_EMBED, (_whole, name: string) => `![[${page(name)}]]`)
      .replace(/\[([^\]\n]+)\]\(\(\(([^()\s]+)\)\)\)/g, (whole, words: string, uid: string) =>
        block(whole, uid, () => words),
      )
      .replace(/\(\(([^()\s]+)\)\)/g, (whole, uid: string) => block(whole, uid))
      .replace(
        /\[([^\]\n]+)\]\(\[\[([^\]\n]+)\]\]\)/g,
        (_whole, words: string, name: string) => `[[${page(name)}|${words}]]`,
      )
      .replace(/(?<!\{)\[\[([^[\]\n]+)\]\](?!\})/g, (_whole, name: string) => `[[${page(name)}]]`)
      .replace(/\{\{\[\[([^\]]+)\]\]\}\}/g, '$1'),
  )
}

function outsideCode(text: string, change: (text: string) => string): string {
  let out = ''
  let at = 0
  for (const [from, to] of codeIn(text)) {
    out += change(text.slice(at, from)) + text.slice(from, to)
    at = to
  }
  return out + change(text.slice(at))
}

function codeIn(text: string): [number, number][] {
  const found: [number, number][] = []
  let at = 0
  while (at < text.length) {
    if (text[at] === '\\') {
      at += 2
      continue
    }
    if (text[at] !== '`') {
      at += 1
      continue
    }

    const opens = runAt(text, at)
    let end = at + opens
    let closes = -1
    while ((end = text.indexOf('`', end)) >= 0) {
      const run = runAt(text, end)
      if (run === opens) {
        closes = end + run
        break
      }
      end += run
    }

    if (closes < 0) {
      at += opens
      continue
    }
    found.push([at, closes])
    at = closes
  }
  return found
}

function runAt(text: string, at: number): number {
  let end = at
  while (text[end] === '`') end += 1
  return end - at
}

export function dayName(title: string): string | null {
  const found = DAY.exec(title)
  if (!found) return null

  const month = MONTHS.indexOf((found[1] ?? '').toLowerCase()) + 1
  return dayOf(`${found[3]}-${String(month).padStart(2, '0')}-${(found[2] ?? '').padStart(2, '0')}`)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
