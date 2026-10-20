/** A Bear export.
 *
 *  Bear writes markdown, so almost nothing has to happen: its files, its folders
 *  and its TextBundles are read the way any folder of notes is. The one thing
 *  that is Bear's own is how it writes a tag with a space in it - `#two words#`,
 *  closed with a second hash - which nothing else reads as a tag at all.
 *
 *  Those become nib's tags, which have no spaces in them: `#two-words`. A tag is
 *  a thing you click, and a space in one is why Bear had to invent the closing
 *  hash in the first place.
 *
 *  The rewrite itself is convert.ts, because the Convert syntax command does the
 *  same thing to notes that arrived some other way, and one rule about what a tag
 *  is beats two.
 *
 *  A backup (`.bear2bk`) is a zip of TextBundles, and each bundle's `info.json`
 *  says what Bear knew about the note: the two days, whether it is in the bin,
 *  archived, or locked behind Bear's password. The bin stays the bin and an
 *  archived note goes into a folder called Archive, the way Keep's do, and a
 *  locked note, whose words the backup holds only encrypted, is counted rather
 *  than written as an empty note. */

import { key } from '../i18n.svelte'
import { relativePath } from '../space-paths'
import { convertTags, outsideCode } from './convert'
import { isHidden } from './folder'
import { dayOf, type Meta } from './meta'
import { readPlain } from './plain'
import type { ImportPlan, Lost } from './plan'
import type { Source } from './sources'

/** Where an archived note goes, as Keep's do. */
const ARCHIVE = 'Archive'

/** The bundle a file sits in, and the rest of its path. */
const BUNDLE = /^(.*?\.textbundle)(?:\/|$)/i

/** What a bundle's `info.json` says, of what is worth reading. */
interface Info {
  id: string | null
  meta: Meta
  trashed: boolean
  archived: boolean
  locked: boolean
}

/** Hidden files stay behind, as from any folder of notes: Bear writes none, and a
 *  folder taken for its export may be somebody's notes kept in git. */
export async function readBear(sources: readonly Source[]): Promise<ImportPlan> {
  const unwrapped = withoutBackupFolder(sources)
  const infos = await bundleInfos(unwrapped)
  const lost: Lost[] = []
  let trashed = 0
  let archived = 0
  let locked = 0

  for (const info of infos.values()) {
    if (info.trashed) trashed += 1
    else if (info.locked) locked += 1
    else if (info.archived) archived += 1
  }

  // An archived note goes into Archive/, moved before anything is placed so its
  // pictures move with it and the links to it follow.
  const placed = unwrapped.map((source) => {
    const info = infoOf(infos, source.path)
    if (!info?.archived || info.trashed || info.locked) return source
    return { ...source, path: `${ARCHIVE}/${source.path}` }
  })
  const moved = new Map<string, Info>()
  for (const [bundle, info] of infos) {
    const archivedHere = info.archived && !info.trashed && !info.locked
    moved.set(archivedHere ? `${ARCHIVE}/${bundle}` : bundle, info)
  }

  const notes = noteIndex(placed, moved)

  const plan = await readPlain(placed, {
    format: 'bear',
    skip: (path) => {
      if (isHidden(path)) return true
      const info = infoOf(moved, path)
      if (info && (info.trashed || info.locked)) return true
      // What a backup says about itself, beside the bundles: Bear's own list of
      // tags, every one of which is in the notes already.
      return moved.size > 0 && /^(?:tags|backup)\.json$/i.test(path.split('/').pop() ?? '')
    },
    words: (text, source) => bearWords(text, source.path, notes),
    meta: (source) => infoOf(moved, source.path)?.meta,
  })

  if (trashed) {
    lost.push({
      text: key('{count} notes were in the bin and stay there'),
      values: { count: trashed },
    })
  }
  if (locked) {
    lost.push({
      text: key('{count} notes are behind a password, which nothing but Bear can open'),
      values: { count: locked },
    })
  }
  if (archived) {
    lost.push({
      text: key('{count} archived notes are in a folder called Archive'),
      values: { count: archived },
    })
  }

  plan.lost.push(...lost)
  return plan
}

/** Bear's closed tags as nib's, leaving every fenced block exactly as written. */
export function bearTags(text: string): string {
  return convertTags(text).text
}

/** Bear's underline, a single tilde either side, which nib reads as lowered text:
 *  `~underlined~`. It becomes the `<u>` the Apple Notes import writes one as. Held
 *  to a pair that opens and closes words, so the tildes in an address,
 *  `example.com/~me/~notes`, stay part of it. */
const UNDERLINE = /(?<![~\\\w/])~([^~\s\\](?:[^~\n]*[^~\s\\])?)~(?![~\w/])/g

/** Bear 1's highlight, `::marked::`. Held to a pair that opens and closes a word,
 *  so `std::vector::size` is a name with colons in it rather than a highlight. */
const COLONS = /(?<![\w:])::([^\s:](?:[^:\n]*[^\s:])?)::(?![\w:])/g

/** A link Bear writes to one of its own notes, by id or by title. */
const NOTE_LINK = /\]\((bear:\/\/x-callback-url\/open-note\?[^)\s]*)\)/g

/** A wikilink, whose target Bear may write as `Note/Heading`. */
const WIKILINK = /(?<!\\)(!?)\[\[([^\]\n|#]+)((?:\|[^\]\n]*)?)\]\]/g

/** A note's words with Bear's own spellings made nib's: its closed tags, its
 *  underline and its old highlight, and a link into Bear that names a note in the
 *  export pointed at that note, so the import's own rewriting makes it a wikilink.
 *  Bear links to a heading with a slash, `[[Note/Heading]]`, which nib reads as a
 *  note in a folder, so where no note is there and the note before the slash is,
 *  it is written `[[Note#Heading]]`. Nothing inside code is touched. */
export function bearWords(text: string, from = '', notes: NoteIndex = EMPTY): string {
  const tagged = bearTags(text)

  return outsideCode(tagged, (words) =>
    words
      .replace(UNDERLINE, '<u>$1</u>')
      .replace(COLONS, '==$1==')
      .replace(WIKILINK, (whole, bang: string, target: string, shown: string) => {
        const heading = notes.heading(target)
        return heading === null ? whole : `${bang}[[${heading}${shown}]]`
      })
      .replace(NOTE_LINK, (whole, address: string) => {
        const to = notes.find(address)
        if (!to) return whole
        const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
        return `](${encoded(relativePath(folder, to))})`
      }),
  )
}

/** The characters a link's target cannot hold as themselves. */
function encoded(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/#/g, '%23')
}

/** The notes in the export, by Bear's id for them and by their title. */
interface NoteIndex {
  find(address: string): string | null
  /** `Note#Heading` for a `Note/Heading` that names a heading rather than a note. */
  heading(target: string): string | null
}

const EMPTY: NoteIndex = { find: () => null, heading: () => null }

function noteIndex(sources: readonly Source[], infos: ReadonlyMap<string, Info>): NoteIndex {
  const byId = new Map<string, string>()
  const byTitle = new Map<string, string>()
  const notes: string[] = []

  for (const source of sources) {
    if (!/\.(md|markdown|txt)$/i.test(source.path)) continue
    const bundle = BUNDLE.exec(source.path)?.[1]
    const info = bundle === undefined ? undefined : infos.get(bundle)
    if (info?.id) byId.set(info.id.toUpperCase(), source.path)

    const named = (bundle ?? source.path).split('/').pop() ?? ''
    const title = named.replace(/\.(textbundle|md|markdown|txt)$/i, '').toLowerCase()
    if (!byTitle.has(title)) byTitle.set(title, source.path)
    notes.push(
      (bundle ?? source.path).replace(/\.(textbundle|md|markdown|txt)$/i, '').toLowerCase(),
    )
  }

  return {
    find(address) {
      let params: URLSearchParams
      try {
        params = new URL(address).searchParams
      } catch {
        return null
      }
      const id = params.get('id')
      if (id) return byId.get(id.toUpperCase()) ?? null
      const title = params.get('title')
      return title ? (byTitle.get(title.toLowerCase()) ?? null) : null
    },
    heading(target) {
      const slash = target.indexOf('/')
      if (slash <= 0) return null
      const wanted = target.trim().toLowerCase()
      if (notes.some((one) => one === wanted || one.endsWith(`/${wanted}`))) return null
      const note = target.slice(0, slash)
      if (!byTitle.has(note.trim().toLowerCase())) return null
      return `${note.trim()}#${target.slice(slash + 1).trim()}`
    },
  }
}

/** A backup unzips to one folder named after it, `Bear Notes 2026-08-12 at
 *  09.54.bear2bk/`, which is the backup's packaging rather than a folder anybody
 *  made, so the notes come out of it. */
function withoutBackupFolder(sources: readonly Source[]): readonly Source[] {
  const top = sources[0]?.path.split('/')[0] ?? ''
  if (!/\.bear2bk$/i.test(top)) return sources
  if (!sources.every((one) => one.path.startsWith(`${top}/`))) return sources

  return sources.map((one) => ({ ...one, path: one.path.slice(top.length + 1) }))
}

/** Every Bear bundle's `info.json`, read, by the bundle's path. A file that does not
 *  parse or was not written by Bear says nothing, and its bundle is a note like any
 *  other. */
async function bundleInfos(sources: readonly Source[]): Promise<Map<string, Info>> {
  const infos = new Map<string, Info>()

  for (const source of sources) {
    const bundle = /^(.*\.textbundle)\/info\.json$/i.exec(source.path)?.[1]
    if (bundle === undefined) continue

    let said: unknown
    try {
      said = JSON.parse(await source.text())
    } catch {
      continue
    }

    const bear = record(record(said)?.['net.shinyfrog.bear'])
    if (!bear) continue

    const made = dayOf(text(bear.creationDate))
    const changed = dayOf(text(bear.modificationDate))
    const meta: Meta = {}
    if (made) meta.date = made
    if (changed) meta.updated = changed

    infos.set(bundle, {
      id: text(bear.uniqueIdentifier),
      meta,
      trashed: flag(bear.trashed),
      archived: flag(bear.archived),
      locked: flag(bear.encrypted),
    })
  }

  return infos
}

/** The bundle a path sits in, read. */
function infoOf(infos: ReadonlyMap<string, Info>, path: string): Info | undefined {
  const bundle = BUNDLE.exec(path)?.[1]
  return bundle === undefined ? undefined : infos.get(bundle)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Bear writes its yes-or-no as 1 and 0. */
function flag(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}
