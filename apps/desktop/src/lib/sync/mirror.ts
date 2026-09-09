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
 *  always the same one: never silently drop an edit.
 *
 *  For a note that is a conflict copy: the other side's copy lands beside ours
 *  with a name that says where it came from, because two people typing in one
 *  paragraph is not something a machine can settle. For a canvas it is a merge,
 *  because a canvas can be settled: everything on it has an id and a time, so
 *  the union of the two keeps every card and every stroke either device drew
 *  and nobody has to go looking for a second file. See canvas-merge.ts. */

import { mergeCanvasFiles } from '@nib/markdown/canvas-merge'
import { isCanvasTarget, isPdfTarget } from '@nib/markdown/links'
import { api, ApiError, type SpaceFile } from '../api'
import { without } from '../records'
import { isNumber, isRecord, isString } from '../stored'
import { invoke } from '../tauri'
import { isUntouchedWelcome } from '../welcome'
import type { Entry } from '../workspace.svelte'

/** What the last sync left on disk, so local edits can be told apart from
 *  remote ones without diffing whole documents. */
interface Tracked {
  id: string
  version: number
  hash: string
}

/** A PDF beside the notes, as the last pass left it. When the file was last
 *  written is what says whether it is worth reading and hashing again: a paper is
 *  tens of megabytes, and a pass runs every few minutes. */
interface TrackedFile {
  hash: string
  modified: number
}

/** One local space folder and the remote space it mirrors. Keyed by `root`,
 *  because the folder is the thing that persists across launches. */
export interface Mirror {
  spaceId: string
  root: string
  cursor: number
  notes: Record<string, Tracked>
  /** The PDFs beside the notes; see `pushFiles`. */
  files: Record<string, TrackedFile>
  /** Whether the space belongs to somebody else. Remembered here rather than
   *  read off the account's listing, because the moment it matters is the
   *  moment the space has gone from that listing: a folder somebody stopped
   *  sharing must go, where one of the account's own that is merely missing is
   *  uploaded again. */
  shared: boolean
}

/** A folder just paired with a space, which knows nothing about it yet. One
 *  place, so a new field cannot be forgotten at one of the five call sites. */
export function newMirror(spaceId: string, root: string, shared = false): Mirror {
  return { spaceId, root, cursor: 0, notes: {}, files: {}, shared }
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
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

/** A file's path as the account names it - relative to the space's folder, with
 *  forward slashes - or null when the file is not in that folder at all.
 *
 *  Which separator a path uses depends on where it came from rather than on what
 *  it points at, so both are read as the same thing. Exported because a note's
 *  room is looked up by this name; see sync.svelte.ts. */
export function within(root: string, path: string): string | null {
  const folder = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = path.replace(/\\/g, '/')

  if (!file.startsWith(`${folder}/`)) return null
  return file.slice(folder.length + 1)
}

/** Whether a path the account named can be joined onto a space's folder.
 *
 *  The listing arrives over the network, and in a shared space the names in it
 *  were written by somebody else: a path that climbs out with `..`, or names a
 *  disk of its own, would have the pass write a file anywhere on this machine
 *  the person can write. Nothing below the folder can say that, so a name that
 *  does is not a note to place at all. Both separators, because which one a
 *  path uses says nothing about where it points. */
function placeable(path: string): boolean {
  if (!path || /^[a-zA-Z]:/.test(path) || /^[\\/]/.test(path)) return false

  return path.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Whether a file on this disk is the same words the account's hash names.
 *
 *  Byte for byte, or the same text written with the other line ending. A file that
 *  was already on this machine with Windows line endings keeps them whenever the
 *  app writes it - see `as_written` in src-tauri/src/notes.rs, which is there so
 *  that correcting one word does not rewrite every line of the file - so its bytes
 *  never hash to what the account holds however exactly the two agree. Reading that
 *  as "somebody wrote here" would put a conflict copy beside every note in such a
 *  folder, on every pass.
 *
 *  The second digest is only ever worked out for a file that has a carriage return
 *  in it, so the ordinary case costs exactly one. */
async function holdsSameWords(local: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if ((await sha256(local)) === hash) return true
  if (!local.includes('\r')) return false

  return (await sha256(local.replace(/\r\n/gu, '\n'))) === hash
}

/** Writes a note that came from the account, keeping whatever the file said before
 *  it as a version first.
 *
 *  Saving keeps a version of the words it is about to replace; this is the other
 *  half of that. Words arriving from the account replace a file just as thoroughly
 *  as a save does, and they were the one overwrite that left nothing behind - so a
 *  note another device got wrong, or a conflict settled the wrong way round, was
 *  recoverable from every device except the one it landed on. Both platforms keep
 *  these the way a save's are kept, so they are in the same version history and the
 *  same sheet puts them back; see recovery.svelte.ts.
 *
 *  `was` is the body the pass has already read, when it has one. Anything else is
 *  read here, because a version of what is being replaced is the whole point: the
 *  conflict copies are written to a name that is usually free, and a second
 *  conflict in one day would otherwise land on the first without a word.
 *
 *  Nothing is kept for a file that is new, that says nothing, or that already says
 *  exactly this. Both platforms drop a version that repeats the one before it
 *  anyway; this saves them the round trip. */
async function writeDown(path: string, content: string, was?: string | null) {
  const previous =
    was === undefined ? await invoke<string>('read_note', { path }).catch(() => null) : was

  if (previous !== null && previous !== content && previous.trim()) {
    await invoke('snapshot_note', { path, content: previous }).catch(() => undefined)
  }

  await invoke('write_note', { path, content })
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

/** The notes that are open in a room, by their id on the account.
 *
 *  A note in a room has one truth and it is the room's: every device in it holds
 *  the same characters, and the room writes them into the account itself. So a
 *  pass neither pushes such a note - there is nothing here the room has not
 *  already carried - nor treats a version it has not seen as a disagreement. The
 *  copy that comes down is simply written, and no conflict copy is ever made for
 *  it, because two devices typing in one paragraph is exactly what the room has
 *  already settled.
 *
 *  Handed in rather than imported so this file stays about moving files: the store
 *  next door knows about rooms, and a test can say there are none. */
export type Joined = ReadonlySet<string>

/** Takes what the account has moved on to. Answers whether anything did.
 *
 *  `wrote` is called once for each note that lands, so whoever is waiting on the
 *  pass can count. Handed in for the same reason `joined` is: this file stays
 *  about moving files, and the store next door is what knows who is waiting. */
export async function pull(
  mirror: Mirror,
  token: string,
  joined: Joined,
  wrote?: () => void,
): Promise<boolean> {
  // Read once: a rename lands in `renamed` while a pass is in the air, and a
  // pass that changed folder halfway would join the new root onto paths it
  // listed under the old one.
  const root = mirror.root
  let moved = false

  for (;;) {
    const page = await api.changes(token, mirror.spaceId, mirror.cursor)
    if (page.notes.length) moved = true

    for (const remote of page.notes) {
      // A name that would land outside the space is left where it is; see
      // `placeable`.
      if (!placeable(remote.path)) continue

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

      // The file and the account already say the same thing, so there is nothing
      // to bring down and nothing to settle: the entry is recorded and the note is
      // done with. This is what mends a mirror that has lost entries - the note is
      // found agreeing rather than judged - and it is the whole of a pass over a
      // space nothing has changed, without a body being fetched for any of it.
      if (local !== null && (await holdsSameWords(local, remote.hash))) {
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        wrote?.()
        continue
      }

      const { content } = await api.readNote(token, remote.id)

      // Whether the file here carries writing the account has never seen. With an
      // entry to compare against, the answer is exact: a file whose words have
      // moved since the last pass was written here.
      //
      // Without one there is nothing to compare, and the only safe answer is that
      // it was. A mirror can lose entries - storage truncated on a phone, a folder
      // paired with a space that already held notes, an account swapped on this
      // machine - and reading "nothing recorded" as "nothing written here" is what
      // turns that into somebody's writing overwritten without trace. A note in a
      // room is the exception either way: the room settled the two character by
      // character before either of them ever became a file. And the app's own
      // welcome note is nobody's writing, so it is simply replaced.
      const diverged =
        local !== null &&
        !joined.has(remote.id) &&
        !isUntouchedWelcome(remote.path, local) &&
        (tracked === undefined || !(await holdsSameWords(local, tracked.hash)))

      if (diverged && local !== content) {
        // A canvas is put back together rather than copied: both drawings are
        // kept, and what is written here is already the answer both devices
        // will settle on, since the merge gives the same file either way round.
        const together = isCanvasTarget(remote.path) ? mergeCanvasFiles(local, content) : null

        await writeDown(
          together === null ? conflictPath(target) : target,
          together ?? content,
          together === null ? undefined : local,
        )

        // An empty hash guarantees the push below sends our copy, now based
        // on the version we just saw, so it lands as the newest one.
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: '' }
        wrote?.()
        continue
      }

      await writeDown(target, content, local)
      mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
      wrote?.()
    }

    // A page saying there is more that hands back the cursor it was given would
    // be asked for forever: the pass would never end, the loop would never set
    // its next timer, and a first sync would never let anybody in.
    const asked = mirror.cursor
    mirror.cursor = page.cursor
    if (!page.more || page.cursor === asked) break
  }

  return moved
}

/** Offers what this machine has. Answers whether anything moved. */
export async function push(mirror: Mirror, token: string, joined: Joined): Promise<boolean> {
  // Read once, for the same reason as in `pull`.
  const root = mirror.root
  const tree = await invoke<Entry>('read_tree', { root }).catch(() => null)
  if (!tree) return false

  const listed = flatten(tree)
  const seen = new Set<string>()
  let moved = false

  // A PDF is bytes rather than words, so it goes up as a blob and the space
  // records where in it the file sits; see `pushFiles`.
  if (await pushFiles(mirror, root, listed, token)) moved = true

  for (const file of listed.filter((one) => !isPdfTarget(one.name))) {
    const path = relative(root, file.path)
    seen.add(path)

    const content = await invoke<string>('read_note', { path: file.path })
    const hash = await sha256(content)
    const tracked = mirror.notes[path]

    if (!tracked) {
      // The app's own welcome note, exactly as the app wrote it, is not writing
      // and does not belong in anybody's account. It used to go up on every launch
      // of the plugin, whose storage is empty every launch, and come back each time
      // Emil deleted it. A character typed into it makes it his and it travels like
      // any other note. See welcome.ts.
      if (isUntouchedWelcome(path, content)) continue

      if (await create(mirror, token, path, content)) moved = true
      continue
    }

    if (tracked.hash === hash) continue

    // A note in a room has already been carried up by the room, keystroke by
    // keystroke, and the room is what writes it into the account. Sending the file
    // as well would be a second writer for one note.
    if (joined.has(tracked.id)) continue

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

/** The PDFs of a space, offered to the account so that a published note linking
 *  one can be served it.
 *
 *  A file goes up the way a pasted picture does: as a blob addressed by the hash
 *  of its bytes. What the space records is where each one sits, and the answer to
 *  that says which hashes the account holds no blob for - which is what makes the
 *  bytes of a thirty megabyte paper travel once and never again.
 *
 *  Nothing comes back down. The list is what makes a paper reachable from a
 *  published page; a second machine gets its PDFs the way it got them the first
 *  time, which is by somebody putting them in the folder. */
async function pushFiles(
  mirror: Mirror,
  root: string,
  listed: readonly Entry[],
  token: string,
): Promise<boolean> {
  const held: Record<string, TrackedFile> = {}
  const manifest: SpaceFile[] = []

  for (const file of listed) {
    if (!isPdfTarget(file.name)) continue

    const path = relative(root, file.path)
    const tracked = mirror.files[path]
    // Read and hashed again only when the file has been written since, so a
    // paper nobody has touched costs nothing at all.
    const hash = tracked?.modified === file.modified ? tracked.hash : await hashFile(file.path)
    if (hash === null) continue

    held[path] = { hash, modified: file.modified }
    manifest.push({ path, hash })
  }

  if (same(mirror.files, held)) return false

  const { missing } = await api.saveSpaceFiles(token, mirror.spaceId, manifest)

  // What the account could not keep is what it has no bytes for. Those go up
  // now, and the list is offered again so their rows land as well.
  if (missing.length) {
    const wanted = new Set(missing)

    for (const file of manifest) {
      if (!wanted.has(file.hash)) continue

      const bytes = await invoke<ArrayBuffer>('read_file', {
        path: join(root, file.path),
      }).catch(() => null)
      if (bytes) await api.putBlob(token, file.hash, 'application/pdf', bytes)
    }

    await api.saveSpaceFiles(token, mirror.spaceId, manifest)
  }

  mirror.files = held
  return true
}

/** The hash of a file's bytes, or null when it cannot be read - a paper deleted
 *  between the listing and here is nothing to report. */
async function hashFile(path: string): Promise<string | null> {
  const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
  return bytes === null ? null : hex(await crypto.subtle.digest('SHA-256', bytes))
}

/** Whether two lists of files say the same thing, so a space nobody has changed
 *  costs no request at all. */
function same(was: Record<string, TrackedFile>, now: Record<string, TrackedFile>): boolean {
  const paths = Object.keys(now)

  return (
    paths.length === Object.keys(was).length &&
    paths.every((path) => was[path]?.hash === now[path]?.hash)
  )
}

/** Never silently drop an edit. A canvas is merged into one file that has
 *  everything both devices drew; anything else keeps the other side's copy
 *  beside ours, since two people typing in one paragraph cannot be settled by a
 *  machine. */
/** A note this machine has and the mirror has never heard of, offered to the
 *  account.
 *
 *  The account may already hold that path - this machine forgot its mirror, two
 *  devices made the same note, a folder was moved back - and the space allows one
 *  live note per path, so it answers 409 with the note that is there. That is a
 *  pairing, not a failure: the two are recorded as one note, and whichever text
 *  differs is settled the way any other conflict is. Before this, the 409 threw
 *  and took the whole pass with it, and the pass came round again to throw again.
 *
 *  Answers whether anything moved. */
async function create(
  mirror: Mirror,
  token: string,
  path: string,
  content: string,
): Promise<boolean> {
  try {
    const { note } = await api.createNote(token, mirror.spaceId, path, content)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return true
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error

    const body = isRecord(error.body) ? error.body : {}
    const theirs = isRecord(body.note) ? body.note : null
    if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) throw error

    const tracked: Tracked = { id: theirs.id, version: theirs.version, hash: theirs.hash }
    mirror.notes[path] = tracked

    // The same words on both sides: paired, and there is nothing to send. Told by
    // the account's own hash rather than by hashing again, which is what the rest
    // of this file compares against too.
    const hash = await sha256(content)
    if (hash === tracked.hash) return false

    // Two notes at one path with different words is the conflict this file has
    // always had an answer for: neither is dropped.
    await keepBoth(mirror, path, tracked, body, token)
    return true
  }
}

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

  const here = join(mirror.root, path)
  const sent = isString(server.content) ? server.content : ''
  const ours = await invoke<string>('read_note', { path: here })

  if (isCanvasTarget(path)) {
    const together = mergeCanvasFiles(ours, sent)
    await writeDown(here, together, ours)
    const { note } = await api.writeNote(token, tracked.id, path, together, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  await writeDown(conflictPath(here), sent)

  // Our version is now the newer one; write it over the server's.
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
    files: readTrackedFiles(value.files),
    // Written by every version since sharing; an older entry is the account's
    // own space, which is what every space was before there were shared ones.
    shared: value.shared === true,
  }
}

/** The PDFs the last pass knew about. An entry that no longer reads as one is
 *  simply absent, which costs that one file a re-read rather than the whole
 *  list a resend. */
function readTrackedFiles(value: unknown): Record<string, TrackedFile> {
  if (!isRecord(value)) return {}

  const out: Record<string, TrackedFile> = {}
  for (const [path, one] of Object.entries(value)) {
    if (!isRecord(one) || !isString(one.hash) || !isNumber(one.modified)) continue

    out[path] = { hash: one.hash, modified: one.modified }
  }

  return out
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
