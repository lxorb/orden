import { fromBase64 } from '../bytes'
import { folderPlan } from './folder'
import { dayOf, type Meta } from './meta'
import { Names, safeParts } from './names'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

interface AppleNote {
  path: string
  title: string
  text: string
  created: number
  modified: number
}

interface AppleMedia {
  path: string
  bytes: string
}

export interface AppleNotes {
  notes: readonly AppleNote[]
  media: readonly AppleMedia[]
  locked: number
  binned: number
  drawn: number
  tables: number
  missing: number
}

export const NO_ACCESS = 'no access'

export const NO_DATABASE = 'no database'

export async function readMacNotes(): Promise<ImportPlan> {
  const { invoke } = await import('../tauri')
  return planFor(await invoke<AppleNotes>('read_apple_notes'))
}

export async function planFor(read: AppleNotes): Promise<ImportPlan> {
  const names = new Names()
  const notes = new Map<string, { title: string; meta: Meta }>()
  const sources: Source[] = []
  const encoder = new TextEncoder()

  for (const note of read.notes) {
    sources.push(sourceOf(note.path, encoder.encode(note.text)))
    notes.set(note.path, {
      title: note.title,
      meta: { date: dayOf(note.created), updated: dayOf(note.modified) },
    })
  }

  for (const one of read.media) sources.push(sourceOf(one.path, fromBase64(one.bytes)))

  const plan = await folderPlan(sources, {
    format: 'apple-notes',
    place: (source) => {
      const said = notes.get(source.path)
      const to = names.free(safeParts(source.path))
      if (!said) return { to }

      return { to, read: (text) => ({ text, title: said.title, meta: said.meta }) }
    },
  })

  plan.lost.push(...lost(read))

  return plan
}

function lost(read: AppleNotes): ImportPlan['lost'] {
  const lines: ImportPlan['lost'] = []

  if (read.locked) {
    lines.push(`${read.locked} notes are behind a password, which nothing but Notes can open`)
  }

  if (read.binned) {
    lines.push(`${read.binned} notes are in Recently Deleted, and stay there`)
  }

  if (read.drawn) {
    lines.push(`${read.drawn} drawings and scans have no picture on this Mac`)
  }

  if (read.tables) {
    lines.push(`${read.tables} tables inside notes do not come over`)
  }

  if (read.missing) {
    lines.push(`${read.missing} attachments are in iCloud rather than on this Mac`)
  }

  return lines
}
