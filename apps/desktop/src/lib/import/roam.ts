/** A Roam Research export, which is one JSON file holding the whole graph.
 *
 *  Roam has no notes and no paragraphs: it has pages, and a page is a tree of
 *  blocks. So a page becomes a note whose words are a nested list, which is what
 *  the tree already looked like on screen and what markdown has for it.
 *
 *  Roam's own spellings, turned into the ones everything else reads:
 *
 *  `((uid))` points at one block. Written out as the words that block said, for
 *  the same reason as in a Logseq graph: the reader was looking at those words,
 *  and nothing outside Roam knows the uid.
 *
 *  `{{[[TODO]]}}` and `{{[[DONE]]}}` are checkboxes, so the block becomes a task.
 *
 *  `^^text^^` is a highlight, which is `==text==` everywhere else.
 *
 *  `{{[[embed]]: ((uid))}}` is another block shown in place, which is its words.
 *
 *  A daily page is called `September 11th, 2026`, which sorts by month name and
 *  is a different name in every language. It becomes `2026-09-11`, in a folder of
 *  its own, so a year of them reads down the file list in order. */

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

export async function readRoam(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const written: Planned[] = []
  const lost: Lost[] = []
  let flattened = 0

  for (const source of sources) {
    if (!/\.json$/i.test(source.path)) continue

    const pages = asPages(await source.text())
    if (!pages) continue

    const blocks = blocksIn(pages)

    for (const page of pages) {
      const said = typeof page.title === 'string' ? page.title.trim() : ''
      if (!said) continue

      const day = dayName(said)
      const title = day ?? safeName(said)
      const folder = day ? `${JOURNALS}/` : ''

      const body = linesOf(page.children, 0, blocks, () => (flattened += 1)).join('\n')

      const meta: Meta = {}
      const made = dayOf(asNumber(page['create-time']))
      const changed = dayOf(asNumber(page['edit-time']))
      if (made) meta.date = made
      if (changed) meta.updated = changed

      written.push({
        kind: 'note',
        path: names.free(`${folder}${title}.md`),
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

/** What every block says, by its uid, for the references. */
function blocksIn(pages: readonly RoamPage[]): Map<string, string> {
  const found = new Map<string, string>()

  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return

    for (const one of blocks) {
      if (!one || typeof one !== 'object') continue
      const block = one as RoamBlock
      const uid = typeof block.uid === 'string' ? block.uid : ''
      const said = typeof block.string === 'string' ? block.string : ''
      if (uid && said) found.set(uid, said)
      walk(block.children)
    }
  }

  for (const page of pages) walk(page.children)
  return found
}

/** A page's blocks as a nested markdown list. A block with children is a list
 *  item with a list under it, which is the shape it had. */
function linesOf(
  blocks: unknown,
  depth: number,
  known: ReadonlyMap<string, string>,
  counted: () => void,
): string[] {
  if (!Array.isArray(blocks)) return []

  const out: string[] = []

  for (const one of blocks) {
    if (!one || typeof one !== 'object') continue

    const block = one as RoamBlock
    const said = typeof block.string === 'string' ? block.string : ''
    const words = roamText(said, known, counted)
    const indent = '  '.repeat(depth)

    if (words.trim()) {
      // A heading is a heading rather than a bullet, but only at the top: a
      // heading three lists deep is not a heading anybody can read.
      const heading = depth === 0 && typeof block.heading === 'number' ? block.heading : 0
      if (heading >= 1 && heading <= 6) out.push(`${'#'.repeat(heading)} ${words}`, '')
      else out.push(`${indent}- ${words}`)
    }

    out.push(...linesOf(block.children, words.trim() ? depth + 1 : depth, known, counted))
  }

  return out
}

/** One block's words, in the spellings everything else reads. */
export function roamText(
  said: string,
  known: ReadonlyMap<string, string> = new Map(),
  counted: () => void = () => undefined,
): string {
  return said
    .replace(/\{\{\[\[TODO\]\]\}\}\s*/g, '[ ] ')
    .replace(/\{\{\[\[DONE\]\]\}\}\s*/g, '[x] ')
    .replace(/\^\^([^^]+)\^\^/g, '==$1==')
    .replace(/\{\{\[\[embed\]\]:\s*\(\(([^)]+)\)\)\s*\}\}/g, (whole, uid: string) => {
      const block = known.get(uid)
      if (!block) return whole
      counted()
      return block
    })
    .replace(/\(\(([^)\s]+)\)\)/g, (whole, uid: string) => {
      const block = known.get(uid)
      if (!block) return whole
      counted()
      return block
    })
    .replace(/\{\{\[\[([^\]]+)\]\]\}\}/g, '$1')
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
