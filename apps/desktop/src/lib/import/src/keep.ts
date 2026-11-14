import { escapeText, plainWords } from '@orden/markdown/escapes'
import { plainTaskWords } from '@orden/markdown/task-line'

import { dayOf, noteText, type Meta } from './meta'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Planned } from './plan'
import type { Source } from './sources'

const ASSETS = 'assets'

const ARCHIVE = 'Archive'

interface KeepNote {
  title?: unknown
  textContent?: unknown
  listContent?: unknown
  labels?: unknown
  attachments?: unknown
  annotations?: unknown
  isTrashed?: unknown
  isArchived?: unknown
  createdTimestampUsec?: unknown
  userEditedTimestampUsec?: unknown
}

export async function readKeep(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const written: Planned[] = []
  const lost: string[] = []
  const attachments = new Map<string, Source>()
  const copied = new Map<Source, string>()
  let trashed = 0
  let archived = 0
  let colours = 0
  let missing = 0
  let unreadable = 0

  for (const source of sources) {
    if (!/\.json$/i.test(source.path)) attachments.set(source.path.toLowerCase(), source)
  }

  for (const source of sources) {
    if (!/\.json$/i.test(source.path)) continue

    const note = parsed(await source.text())
    if (note === 'broken') {
      unreadable += 1
      continue
    }
    if (!note) continue
    if (note.isTrashed === true) {
      trashed += 1
      continue
    }

    if (note.isArchived === true) archived += 1
    if (typeof note.color === 'string' && note.color !== 'DEFAULT') colours += 1

    const folder = note.isArchived === true ? `${ARCHIVE}/` : ''
    const words: string[] = []

    const text =
      typeof note.textContent === 'string' ? note.textContent.replace(/\r\n?/g, '\n').trim() : ''
    if (text) words.push(plainWords(text))

    const items = listItems(note.listContent)
    if (items.length) words.push(items.map(taskLine).join('\n'))

    const links = linksOf(note.annotations, text)
    if (links.length) words.push(links.join('\n'))

    const pictures: string[] = []
    for (const said of filePaths(note.attachments)) {
      const file = beside(attachments, source.path, said)
      if (!file) {
        missing += 1
        continue
      }

      let path = copied.get(file)
      if (!path) {
        path = names.free(`${ASSETS}/${safeName(file.path.split('/').pop() ?? said)}`)
        copied.set(file, path)
        written.push({ kind: 'file', path, bytes: await file.bytes() })
      }
      pictures.push(`![](${folder ? '../' : ''}${encoded(path)})`)
    }

    if (pictures.length) words.push(pictures.join('\n'))

    const body = words.join('\n\n')
    const said = typeof note.title === 'string' ? note.title.trim() : ''
    const title =
      (said ? safeName(said) : (titleFrom(text) ?? titleFrom(items[0]?.text ?? ''))) ?? 'Untitled'

    const meta: Meta = { tags: labelNames(note.labels) }
    const made = dayOf(asNumber(note.createdTimestampUsec))
    const changed = dayOf(asNumber(note.userEditedTimestampUsec))
    if (made) meta.date = made
    if (changed) meta.updated = changed

    written.push({
      kind: 'note',
      path: names.free(`${folder}${title}.md`),
      text: noteText(title, body, meta),
    })
  }

  if (trashed) {
    lost.push(`${trashed} notes were in the bin and stay there`)
  }

  if (archived) {
    lost.push(`${archived} archived notes are in a folder called Archive`)
  }

  if (unreadable) {
    lost.push(
      unreadable === 1
        ? '1 file could not be read, so it was left out'
        : `${unreadable} files could not be read, so they were left out`,
    )
  }

  if (missing) {
    lost.push(
      missing === 1
        ? '1 attachment was missing from the export or could not be read'
        : `${missing} attachments were missing from the export or could not be read`,
    )
  }

  if (colours) {
    lost.push('The colours a note had are not kept')
  }

  return { format: 'keep', files: written, lost }
}

function parsed(text: string): (KeepNote & { color?: unknown }) | null | 'broken' {
  let said: unknown
  try {
    said = JSON.parse(text)
  } catch {
    return 'broken'
  }

  if (!said || typeof said !== 'object' || Array.isArray(said)) return null

  const note = said as KeepNote
  const looksLikeOne =
    'textContent' in note || 'listContent' in note || 'isTrashed' in note || 'title' in note
  return looksLikeOne ? note : null
}

function listItems(said: unknown): Item[] {
  if (!Array.isArray(said)) return []

  const items: Item[] = []
  for (const one of said) {
    if (!one || typeof one !== 'object') continue
    const item = one as { text?: unknown; isChecked?: unknown }
    const text = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : ''
    if (!text) continue

    items.push({ checked: item.isChecked === true, text })
  }

  return items
}

interface Item {
  checked: boolean
  text: string
}

function taskLine(item: Item): string {
  return `- [${item.checked ? 'x' : ' '}] ${plainTaskWords(item.text)}`
}

function linksOf(said: unknown, text: string): string[] {
  if (!Array.isArray(said)) return []

  const links: string[] = []
  for (const one of said) {
    if (!one || typeof one !== 'object') continue
    const card = one as { url?: unknown; title?: unknown }
    const url = typeof card.url === 'string' ? card.url.trim() : ''
    if (!/^[a-z][a-z0-9+.-]*:[^\s<>]+$/i.test(url) || text.includes(url)) continue

    const title = typeof card.title === 'string' ? card.title.replace(/\s+/g, ' ').trim() : ''
    const shown = escapeText(title, { addresses: false })
    links.push(shown ? `- [${shown}](<${url}>)` : `- <${url}>`)
  }

  return links
}

function encoded(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function labelNames(said: unknown): string[] {
  if (!Array.isArray(said)) return []

  const names: string[] = []
  for (const one of said) {
    if (!one || typeof one !== 'object') continue
    const label = (one as { name?: unknown }).name
    if (typeof label === 'string' && label.trim()) names.push(label.trim())
  }

  return names
}

function filePaths(said: unknown): string[] {
  if (!Array.isArray(said)) return []

  const paths: string[] = []
  for (const one of said) {
    if (!one || typeof one !== 'object') continue
    const path = (one as { filePath?: unknown }).filePath
    if (typeof path === 'string' && path.trim()) paths.push(path.trim())
  }

  return paths
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function beside(
  files: ReadonlyMap<string, Source>,
  notePath: string,
  named: string,
): Source | null {
  const at = notePath.lastIndexOf('/')
  const folder = at === -1 ? '' : notePath.slice(0, at + 1)
  const name = named.split('/').pop() ?? named

  const found =
    files.get(`${folder}${name}`.toLowerCase()) ??
    files.get(named.toLowerCase()) ??
    [...files.entries()].find(([path]) => path.endsWith(`/${name.toLowerCase()}`))?.[1]
  if (found) return found

  const stem = /^(.+)\.(jpe?g|png|gif|webp|heic|heif)$/i.exec(name)?.[1]?.toLowerCase()
  if (!stem) return null

  const picture = new RegExp(
    `^${escaped(`${folder}${stem}`.toLowerCase())}\\.(jpe?g|png|gif|webp|heic|heif)$`,
  )
  return [...files.entries()].find(([path]) => picture.test(path))?.[1] ?? null
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
