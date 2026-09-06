/** One space, moved between this machine and the account.
 *
 *  A pass over a space is two halves: take what the server has, then offer
 *  what we have. Neither knows anything about the loop that calls them - how
 *  often, when to give up, what the light says - which is the store next door.
 *
 *  What makes it work without diffing whole documents is the hash of each note
 *  as it stood after the last pass. A local hash that no longer matches means
 *  the file changed here; a version that has moved means it changed there; and
 *  both at once is the only case that needs a decision. That decision is
 *  always the same one: never silently drop an edit. The other side's copy
 *  lands beside ours with a name that says where it came from. */

import { api, ApiError } from '../api'
import { without } from '../records'
import { isRecord, isString } from '../stored'
import { invoke } from '../tauri'
import type { Entry } from '../workspace.svelte'

/** What the last sync left on disk, so local edits can be told apart from
 *  remote ones without diffing whole documents. */
interface Tracked {
  id: string
  version: number
  hash: string
}

/** One local space folder and the remote space it mirrors. Keyed by `root`,
 *  because the folder is the thing that persists across launches. */
export interface Mirror {
  spaceId: string
  root: string
  cursor: number
  notes: Record<string, Tracked>
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function join(root: string, path: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root}${separator}${path.split('/').join(separator)}`
}

function relative(root: string, absolute: string): string {
  return absolute
    .slice(root.length)
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/')
}

/** Where the other side's copy goes when both changed the same note. */
function conflictPath(path: string): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return path.replace(/(\.[^.\\/]+)$/, ` (from another device ${stamp})$1`)
}

function flatten(entry: Entry): Entry[] {
  const out: Entry[] = []
  const walk = (node: Entry) => {
    for (const child of node.children) {
      if (child.is_dir) walk(child)
      else out.push(child)
    }
  }
  walk(entry)
  return out
}

/** Takes what the account has moved on to. Answers whether anything did. */
export async function pull(mirror: Mirror, token: string): Promise<boolean> {
  // Read once: a rename lands in `renamed` while a pass is in the air, and a
  // pass that changed folder halfway would join the new root onto paths it
  // listed under the old one.
  const root = mirror.root
  let moved = false

  for (;;) {
    const page = await api.changes(token, mirror.spaceId, mirror.cursor)
    if (page.notes.length) moved = true

    for (const remote of page.notes) {
      const target = join(root, remote.path)

      if (remote.deleted) {
        if (mirror.notes[remote.path]) {
          await invoke('delete_note', { path: target }).catch(() => undefined)
          mirror.notes = without(mirror.notes, remote.path)
        }
        continue
      }

      const tracked = mirror.notes[remote.path]
      if (tracked?.version === remote.version) continue

      const local = await invoke<string>('read_note', { path: target }).catch(() => null)
      const { content } = await api.readNote(token, remote.id)

      // The local file carries edits that never reached the server, and the
      // server moved too. Overwriting here would throw one of them away.
      const diverged = tracked && local !== null && (await sha256(local)) !== tracked.hash

      if (diverged && local !== content) {
        await invoke('write_note', { path: conflictPath(target), content })
        // An empty hash guarantees the push below sends our copy, now based
        // on the version we just saw, so it lands as the newest one.
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: '' }
        continue
      }

      await invoke('write_note', { path: target, content })
      mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
    }

    mirror.cursor = page.cursor
    if (!page.more) break
  }

  return moved
}

/** Offers what this machine has. Answers whether anything moved. */
export async function push(mirror: Mirror, token: string): Promise<boolean> {
  // Read once, for the same reason as in `pull`.
  const root = mirror.root
  const tree = await invoke<Entry>('read_tree', { root }).catch(() => null)
  if (!tree) return false

  const seen = new Set<string>()
  let moved = false

  for (const file of flatten(tree)) {
    const path = relative(root, file.path)
    seen.add(path)

    const content = await invoke<string>('read_note', { path: file.path })
    const hash = await sha256(content)
    const tracked = mirror.notes[path]

    if (!tracked) {
      const { note } = await api.createNote(token, mirror.spaceId, path, content)
      mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
      moved = true
      continue
    }

    if (tracked.hash === hash) continue
    moved = true

    try {
      const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
      mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error
      await keepBoth(mirror, path, tracked, error.body, token)
    }
  }

  // A file that vanished locally is a delete, not a gap.
  for (const [path, tracked] of Object.entries(mirror.notes)) {
    if (seen.has(path)) continue

    await api.deleteNote(token, tracked.id).catch(() => undefined)
    mirror.notes = without(mirror.notes, path)
    moved = true
  }

  return moved
}

/** Never silently drop an edit: the other device's copy lands beside ours. */
async function keepBoth(
  mirror: Mirror,
  path: string,
  tracked: Tracked,
  conflict: unknown,
  token: string,
) {
  // The body of a 409 is whatever the server sent; only a real version to
  // base the next write on makes this worth doing at all.
  const server = isRecord(conflict) ? conflict : {}
  const theirs = isRecord(server.note) ? server.note : null
  if (typeof theirs?.version !== 'number') return

  await invoke('write_note', {
    path: conflictPath(join(mirror.root, path)),
    content: isString(server.content) ? server.content : '',
  })

  // Our version is now the newer one; write it over the server's.
  const ours = await invoke<string>('read_note', { path: join(mirror.root, path) })
  const { note } = await api.writeNote(token, tracked.id, path, ours, theirs.version)
  mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
}

/** One mirror as it was written down, once it reads as one. A mirror with no
 *  space to point at is worse than none: the next pass would sync a folder
 *  against nothing and read every note in it as deleted. */
export function readMirror(root: string, value: unknown): Mirror | null {
  if (!isRecord(value) || !isString(value.spaceId)) return null

  return {
    spaceId: value.spaceId,
    // The key is the folder; an older entry that disagrees with itself takes
    // the key, which is what every lookup goes through.
    root,
    cursor: typeof value.cursor === 'number' ? value.cursor : 0,
    notes: readTracked(value.notes),
  }
}

function readTracked(value: unknown): Record<string, Tracked> {
  if (!isRecord(value)) return {}

  const out: Record<string, Tracked> = {}
  for (const [path, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.id) || !isString(one.hash)) continue
    if (typeof one.version !== 'number') continue

    out[path] = { id: one.id, version: one.version, hash: one.hash }
  }

  return out
}
