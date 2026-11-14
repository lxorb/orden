import { log, invoke } from '../../platform/src/api'
import { sameWebNote, settleShortcuts } from '@orden/scan/settle'
import type { Entry } from '../../workspace.svelte'
import { writeDown } from './write-down'

const STAMP = / \(from another device \d{4}-\d{2}-\d{2}\)(?: \d+)?/gu

export function copiedFrom(path: string): string | null {
  const ending = /\.(url|webloc)$/iu.exec(path)
  if (!ending) return null

  const stem = path.slice(0, ending.index)
  const plain = stem.replace(STAMP, '')
  return plain === stem ? null : plain + ending[0]
}

export interface Folded {
  kept: string
  gone: string
}

export async function foldWebCopies(files: readonly Entry[]): Promise<Folded[]> {
  const byPath = new Map(files.map((one) => [one.path, one]))
  const copies = files.filter((one) => copiedFrom(one.path) !== null)
  if (copies.length === 0) return []

  const folded: Folded[] = []
  for (const copy of [...copies].sort((a, b) => a.modified - b.modified)) {
    const note = byPath.get(copiedFrom(copy.path) ?? '')
    if (!note) continue

    try {
      if (await foldInto(note, copy)) folded.push({ kept: note.path, gone: copy.path })
    } catch (error) {
      log('warn', `sync: ${copy.path} not folded into ${note.path} - ${String(error)}`)
    }
  }

  return folded
}

async function foldInto(note: Entry, copy: Entry): Promise<boolean> {
  const [ours, theirs] = await Promise.all([
    invoke<string>('read_note', { path: note.path }),
    invoke<string>('read_note', { path: copy.path }),
  ])
  if (!sameWebNote(note.path, ours, theirs)) return false

  const one = settleShortcuts(note.path, ours, theirs, copy.modified > note.modified)
  if (one !== ours) await writeDown(note.path, one, ours)

  await invoke('snapshot_note', { path: copy.path, content: theirs }).catch(() => undefined)
  await invoke('trash_item', { path: copy.path, kind: 'note' })
  note.modified = Math.max(note.modified, copy.modified)
  return true
}
