import { relativePath } from '../space-paths'
import { convertTags, outsideCode } from './convert'
import { isHidden } from './folder'
import { dayOf, type Meta } from './meta'
import { readPlain } from './plain'
import type { ImportPlan } from './plan'
import type { Source } from './sources'

const ARCHIVE = 'Archive'

const BUNDLE = /^(.*?\.textbundle)(?:\/|$)/i

interface Info {
  id: string | null
  meta: Meta
  trashed: boolean
  archived: boolean
  locked: boolean
}

export async function readBear(sources: readonly Source[]): Promise<ImportPlan> {
  const unwrapped = withoutBackupFolder(sources)
  const infos = await bundleInfos(unwrapped)
  const lost: string[] = []
  let trashed = 0
  let archived = 0
  let locked = 0

  for (const info of infos.values()) {
    if (info.trashed) trashed += 1
    else if (info.locked) locked += 1
    else if (info.archived) archived += 1
  }

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
      return moved.size > 0 && /^(?:tags|backup)\.json$/i.test(path.split('/').pop() ?? '')
    },
    words: (text, source) => bearWords(text, source.path, notes),
    meta: (source) => infoOf(moved, source.path)?.meta,
  })

  if (trashed) {
    lost.push(`${trashed} notes were in the bin and stay there`)
  }
  if (locked) {
    lost.push(`${locked} notes are behind a password, which nothing but Bear can open`)
  }
  if (archived) {
    lost.push(`${archived} archived notes are in a folder called Archive`)
  }

  plan.lost.push(...lost)
  return plan
}

export function bearTags(text: string): string {
  return convertTags(text).text
}

const UNDERLINE = /(?<![~\\\w/])~([^~\s\\](?:[^~\n]*[^~\s\\])?)~(?![~\w/])/g

const COLONS = /(?<![\w:])::([^\s:](?:[^:\n]*[^\s:])?)::(?![\w:])/g

const NOTE_LINK = /\]\((bear:\/\/x-callback-url\/open-note\?[^)\s]*)\)/g

const WIKILINK = /(?<!\\)(!?)\[\[([^\]\n|#]+)((?:\|[^\]\n]*)?)\]\]/g

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

function encoded(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/#/g, '%23')
}

interface NoteIndex {
  find(address: string): string | null
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

function withoutBackupFolder(sources: readonly Source[]): readonly Source[] {
  const top = sources[0]?.path.split('/')[0] ?? ''
  if (!/\.bear2bk$/i.test(top)) return sources
  if (!sources.every((one) => one.path.startsWith(`${top}/`))) return sources

  return sources.map((one) => ({ ...one, path: one.path.slice(top.length + 1) }))
}

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

function flag(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}
