import { isCanvasTarget, isPagesTarget, isPdfTarget, isWebTarget } from '@orden/markdown/links'
import { inForeignCopy } from '@orden/sync-core'
import { isUntouchedAgents } from '../agents-seed'
import { api } from '../accounts/src/api'
import { sha256, relativeTo, invoke } from '../platform/src/api'
import { isUntouchedWelcome } from '../welcome'
import type { Entry } from '../workspace.svelte'
import { behind, unixLines } from './ancestry'

export interface Here {
  name: string
  root: string
}

export interface There {
  id: string
  name: string
  role: string
}

export async function meeting(
  token: string,
  local: readonly Here[],
  remote: readonly There[],
): Promise<Here[]> {
  const met: Here[] = []
  for (const space of local) {
    const namesake = remote.find((one) => one.role === 'owner' && one.name === space.name)
    if (namesake && (await meets(token, space.root, namesake.id))) met.push(space)
  }
  return met
}

async function meets(token: string, root: string, spaceId: string): Promise<boolean> {
  const held = await notesOf(token, spaceId)
  if (!held.size) return false

  const tree = await invoke<Entry>('read_tree', { root }).catch(() => null)
  if (!tree) return false

  const differing: { id: string; hash: string }[] = []
  for (const file of files(tree)) {
    const path = relativeTo(root, file.path)
    if (!words(path)) continue

    const theirs = held.get(path)
    if (!theirs) continue

    const content = await invoke<string>('read_note', { path: file.path }).catch(() => null)
    if (content === null || isUntouchedWelcome(path, content) || isUntouchedAgents(path, content)) {
      continue
    }

    const hashes = [await sha256(content)]
    if (content.includes('\r')) hashes.push(await sha256(unixLines(content)))
    if (!hashes.includes(theirs.hash)) {
      for (const hash of hashes) differing.push({ id: theirs.id, hash })
    }
  }

  if (!differing.length) return false
  const older = await behind(token, differing)
  return differing.some((one) => !older.has(one.id))
}

async function notesOf(
  token: string,
  spaceId: string,
): Promise<Map<string, { id: string; hash: string }>> {
  const out = new Map<string, { id: string; hash: string }>()
  let cursor = 0
  for (;;) {
    const page = await api.changes(token, spaceId, cursor).catch(() => null)
    if (!page) return out
    for (const note of page.notes) {
      if (note.deleted) out.delete(note.path)
      else out.set(note.path, { id: note.id, hash: note.hash })
    }
    if (!page.more || page.cursor === cursor) return out
    cursor = page.cursor
  }
}

function words(path: string): boolean {
  return (
    !isPdfTarget(path) &&
    !isCanvasTarget(path) &&
    !isPagesTarget(path) &&
    !isWebTarget(path) &&
    !inForeignCopy(path)
  )
}

function files(entry: Entry): Entry[] {
  return entry.children.flatMap((child) => (child.is_dir ? files(child) : [child]))
}
