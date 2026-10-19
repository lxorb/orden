/** A Roam Research export, which is one JSON file holding the whole graph.
 *
 *  Roam has no notes and no paragraphs: it has pages, and a page is a tree of
 *  blocks. So a page becomes a note whose words are a nested list, which is what
 *  the tree already looked like on screen and what markdown has for it. A block
 *  of several lines, a code block most often, stays inside its list item.
 *
 *  Roam's own spellings, turned into the ones everything else reads:
 *
 *  `((uid))` points at one block. Written out as the words that block said, for
 *  the same reason as in a Logseq graph: the reader was looking at those words,
 *  and nothing outside Roam knows the uid. `[these words](((uid)))` showed its
 *  own words, which it keeps.
 *
 *  `{{[[TODO]]}}` and `{{[[DONE]]}}` are checkboxes, so the block becomes a task.
 *
 *  `^^text^^` is a highlight, which is `==text==` everywhere else, and `__text__`
 *  is Roam's italics, which is `*text*`: markdown reads the underscores as bold.
 *
 *  `{{[[embed]]: ((uid))}}` is another block shown in place, which is its words,
 *  and the blocks under it when it stands alone. `{{[[embed]]: [[Page]]}}` is a
 *  page shown in place, which is nib's `![[Page]]`.
 *
 *  `[these words]([[Page]])` is a link to a page that shows other words, which is
 *  `[[Page|these words]]`.
 *
 *  A daily page is called `September 11th, 2026`, which sorts by month name and
 *  is a different name in every language. It becomes `2026-09-11`, in a folder of
 *  its own, so a year of them reads down the file list in order, and a link to a
 *  day says that date too.
 *
 *  A title with a slash in it, `roam/css`, is a page in a folder, the way a link
 *  to it already reads. A title the import could not keep as a file name answers
 *  to it as an alias, so the links to it still find it.
 *
 *  Code, fenced or inline, is kept exactly as it was written. */

import { foldName } from '@nib/markdown/links'

import { key } from '../i18n.svelte'

import { dayOf, noteText, type Meta } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** Where the days go, so they are not mixed in with the pages somebody named. */
const JOURNALS = 'Journals'

/** `September 11th, 2026`, which is the only shape Roam names a day. */
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

/** Every spelling of an embed Roam has written: with brackets or without, and
 *  `embed-path`, which shows the path to the block above it as well. */
const EMBED = String.raw`\{\{\s*(?:\[\[)?embed(?:-path)?(?:\]\])?\s*:\s*`

/** An embed of one block, standing alone or in a sentence. */
const BLOCK_EMBED = new RegExp(`${EMBED}\\(\\(([^()\\s]+)\\)\\)\\s*\\}\\}`, 'g')

/** An embed of a whole page. */
const PAGE_EMBED = new RegExp(`${EMBED}\\[\\[([^\\]\\n]+)\\]\\]\\s*\\}\\}`, 'g')

/** Code, fenced or inline, where Roam's spellings are words to keep. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g

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

/** What the rest of the graph knows that one block needs. */
interface Graph {
  /** What every block says, by its uid. */
  known: ReadonlyMap<string, string>
  /** The blocks under each block, by its uid, for an embed that shows them. */
  under: ReadonlyMap<string, unknown>
  counted: () => void
}

export async function readRoam(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const written: Planned[] = []
  const lost: Lost[] = []
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
    lost.push({
      text: key('{count} block references were written out as the words they pointed at'),
      values: { count: flattened },
    })
  }

  return { format: 'roam', files: written, lost }
}

/** The pages of a Roam export, or null for a JSON that is not one. */
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

/** What every block says, by its uid, for the references, and what is under it,
 *  for the embeds. */
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

/** A page's blocks as a nested markdown list. A block with children is a list
 *  item with a list under it, which is the shape it had. `embedding` is the
 *  blocks being shown in place on the way here, so a block that embeds its own
 *  parent is shown once rather than forever. */
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

    // A block that is nothing but an embed shows the embedded block's own
    // children under it, as Roam did.
    const embedded = new RegExp(`^\\s*${BLOCK_EMBED.source}\\s*$`).exec(said)?.[1]
    const shown = embedded && graph.known.has(embedded) && !here.has(embedded) ? embedded : null
    const words = roamText(said, graph.known, graph.counted, new Set(uid ? [uid] : []))
    const indent = '  '.repeat(depth)

    // A heading is a heading rather than a bullet, but only at the top: a
    // heading three lists deep is not a heading anybody can read. What is under
    // it is the list that follows it, rather than a list under nothing.
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
      out.push(...linesOf(graph.under.get(shown), next, graph, new Set([...here, shown])))
    }
    out.push(...linesOf(block.children, next, graph, here))
  }

  return out
}

/** A block's words as the text of a list item: every line after the first sits
 *  inside the item, and a code block's closing fence, which Roam writes on the
 *  end of its last line, has a line of its own. */
function itemText(words: string, indent: string): string {
  const fenced = words.replace(/^(\s*```[^\n]*\n[\s\S]*?[^\n])```\s*$/, '$1\n```')
  return fenced
    .split('\n')
    .map((line, at) => (at && line.trim() ? `${indent}${line}` : line))
    .join('\n')
}

/** One block's words, in the spellings everything else reads. */
export function roamText(
  said: string,
  known: ReadonlyMap<string, string> = new Map(),
  counted: () => void = () => undefined,
  showing: ReadonlySet<string> = new Set(),
): string {
  // The block's words are Roam's own spellings too, and are written out the same
  // way, except where a block points back at one already being written out.
  const block = (whole: string, uid: string, as?: () => string) => {
    const words = known.get(uid)
    if (words === undefined || showing.has(uid)) return whole
    counted()
    return as ? as() : roamText(words, known, counted, new Set([...showing, uid]))
  }
  // A daily page is named by its date now, so a link to it says that date.
  const page = (name: string) => dayName(name.trim()) ?? name

  return outsideCode(said, (text) =>
    text
      .replace(/\{\{\[\[TODO\]\]\}\}\s*/g, '[ ] ')
      .replace(/\{\{\[\[DONE\]\]\}\}\s*/g, '[x] ')
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

/** A block's words with `change` made everywhere but in its code. */
function outsideCode(text: string, change: (text: string) => string): string {
  let out = ''
  let at = 0
  for (const found of text.matchAll(CODE)) {
    out += change(text.slice(at, found.index)) + found[0]
    at = found.index + found[0].length
  }
  return out + change(text.slice(at))
}

/** A Roam daily page's name as the date it is, or null for a page somebody
 *  named. */
export function dayName(title: string): string | null {
  const found = DAY.exec(title)
  if (!found) return null

  const month = MONTHS.indexOf((found[1] ?? '').toLowerCase()) + 1
  return dayOf(`${found[3]}-${String(month).padStart(2, '0')}-${(found[2] ?? '').padStart(2, '0')}`)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
