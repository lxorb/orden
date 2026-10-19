/** Which spaces on this device would meet different words in the account's space of
 *  the same name, were they to join it.
 *
 *  Asked only about notes of unknown standing - another account's, or ones no pass has
 *  seen; see returning.ts. A space meets its namesake when one of its notes is at a
 *  path the account's space also has, with other words, and those words are not simply
 *  an older version the account once held (`behind`, sync/ancestry.ts). A note the
 *  account lacks is only added; a canvas, a page note or a web note settles into one
 *  either way (sync/pass.ts); the app's own untouched welcome note and AGENTS.md are
 *  nobody's writing. None of those is a reason to ask. */

import { isCanvasTarget, isPagesTarget, isPdfTarget, isWebTarget } from '@nib/markdown/links'
import { inForeignCopy } from '@nib/sync-core/foreign'
import { isUntouchedAgents } from '../agents-seed'
import { api } from '../api'
import { sha256 } from '../bytes'
import { relativeTo } from '../space-paths'
import { invoke } from '../tauri'
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

/** The spaces here, out of `local`, that would meet different words in the account. */
export async function meeting(
  token: string,
  local: readonly Here[],
  remote: readonly There[],
): Promise<Here[]> {
  const met: Here[] = []
  for (const space of local) {
    // Paired by name only with a space of the account's own; see space-plan.ts.
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

    // Either line ending, as the pass reads one (`holdsSameWords` in pass.ts).
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

/** Every live note the account's space holds, by path. */
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

/** Whether a file is words two people could have written differently: a note, not a
 *  plane or a web note that settles into one, nor a PDF, nor another tool's copy. */
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
