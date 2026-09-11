/** A Google Keep export, out of Takeout.
 *
 *  Takeout writes a folder with three files per note: a JSON with everything in
 *  it, an HTML copy of the same thing, and the attachments beside them. The JSON
 *  is the one to read, and the HTML is left where it is.
 *
 *  Keep's notes are a list or a paragraph, and the list is the interesting half:
 *  every item carries whether it was ticked, which is exactly a task list. So a
 *  Keep shopping list arrives as a shopping list with the boxes in the state it
 *  was left in.
 *
 *  Labels become tags. Colours do not come: a colour is how a note was found on
 *  the Keep wall, and the wall is what nib's search, tags and picture of the space
 *  are for. Pinning does not come either, for the same reason.
 *
 *  What was in the bin stays in the bin. Takeout puts deleted notes in the export
 *  and Keep would have thrown them away within the week; importing them would be
 *  the one act of this whole feature that nobody asked for. The count is said. */

import { key } from '../i18n.svelte'

import { dayOf, noteText, type Meta } from './meta'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

const ASSETS = 'assets'

/** Where an archived note goes: a folder of its own, because an archive is a
 *  place rather than a property, and nothing in nib reads a property saying so. */
const ARCHIVE = 'Archive'

interface KeepNote {
  title?: unknown
  textContent?: unknown
  listContent?: unknown
  labels?: unknown
  attachments?: unknown
  isTrashed?: unknown
  isArchived?: unknown
  createdTimestampUsec?: unknown
  userEditedTimestampUsec?: unknown
}

export async function readKeep(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const written: Planned[] = []
  const lost: Lost[] = []
  const attachments = new Map<string, Source>()
  let trashed = 0
  let archived = 0
  let colours = 0

  for (const source of sources) {
    if (!/\.json$/i.test(source.path)) attachments.set(source.path.toLowerCase(), source)
  }

  for (const source of sources) {
    if (!/\.json$/i.test(source.path)) continue

    const note = parsed(await source.text())
    if (!note) continue
    if (note.isTrashed === true) {
      trashed += 1
      continue
    }

    if (note.isArchived === true) archived += 1
    if (typeof note.color === 'string' && note.color !== 'DEFAULT') colours += 1

    const folder = note.isArchived === true ? `${ARCHIVE}/` : ''
    const words: string[] = []

    if (typeof note.textContent === 'string' && note.textContent.trim()) {
      words.push(note.textContent.trim())
    }

    const items = listItems(note.listContent)
    if (items.length) words.push(items.join('\n'))

    const pictures: string[] = []
    for (const said of filePaths(note.attachments)) {
      const file = beside(attachments, source.path, said)
      if (!file) continue

      const path = names.free(`${ASSETS}/${safeName(said.split('/').pop() ?? said)}`)
      written.push({ kind: 'file', path, bytes: await file.bytes() })
      pictures.push(`![](${folder ? '../' : ''}${path.replace(/ /g, '%20')})`)
    }

    if (pictures.length) words.push(pictures.join('\n'))

    const body = words.join('\n\n')
    const said = typeof note.title === 'string' ? note.title.trim() : ''
    const title = (said ? safeName(said) : titleFrom(body)) ?? 'Untitled'

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
    lost.push({
      text: key('{count} notes were in the bin and stay there'),
      values: { count: trashed },
    })
  }

  if (archived) {
    lost.push({
      text: key('{count} archived notes are in a folder called Archive'),
      values: { count: archived },
    })
  }

  if (colours) {
    lost.push({ text: key('The colours a note had are not kept') })
  }

  return { format: 'keep', files: written, lost }
}

/** A note's JSON, or null for a file that is not one: Takeout drops a couple of
 *  its own JSONs into the same folder. */
function parsed(text: string): (KeepNote & { color?: unknown }) | null {
  try {
    const said: unknown = JSON.parse(text)
    if (!said || typeof said !== 'object' || Array.isArray(said)) return null

    const note = said as KeepNote
    const looksLikeOne =
      'textContent' in note || 'listContent' in note || 'isTrashed' in note || 'title' in note
    return looksLikeOne ? note : null
  } catch {
    return null
  }
}

/** A ticked list as a task list, which is what it was. */
function listItems(said: unknown): string[] {
  if (!Array.isArray(said)) return []

  const items: string[] = []
  for (const one of said) {
    if (!one || typeof one !== 'object') continue
    const item = one as { text?: unknown; isChecked?: unknown }
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (!text) continue

    items.push(`- [${item.isChecked === true ? 'x' : ' '}] ${text}`)
  }

  return items
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

/** The attachment a note names, looked for beside the note first and anywhere in
 *  the export after: Takeout keeps them together, and a reader who picked only
 *  some of the files should still get the pictures they picked. */
function beside(
  files: ReadonlyMap<string, Source>,
  notePath: string,
  named: string,
): Source | null {
  const at = notePath.lastIndexOf('/')
  const folder = at === -1 ? '' : notePath.slice(0, at + 1)
  const name = named.split('/').pop() ?? named

  return (
    files.get(`${folder}${name}`.toLowerCase()) ??
    files.get(named.toLowerCase()) ??
    [...files.entries()].find(([path]) => path.endsWith(`/${name.toLowerCase()}`))?.[1] ??
    null
  )
}
