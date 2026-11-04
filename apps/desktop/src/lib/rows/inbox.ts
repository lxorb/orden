/** Which note is each space's inbox, and making it the first time it is needed.
 *
 *  Orden's own unless the reader chose a note of theirs (docs/tasks.md 5.1, #1044):
 *  `.Inbox.md` at the root of the space (`INBOX_PATH`), hidden, so the file list, the
 *  search, the link scan, the graph and Obsidian all leave it out. A task with no place
 *  puts no file into the space the reader did not make, and the inbox is still a note
 *  underneath: the rows read it (`own` in store.ts), the one write path edits it, sync
 *  carries it as a note (`carriedOwn`) and it is in any copy of the space's folder. A
 *  quick add that names no note lands there, and the Inbox view lists the open tasks of
 *  every space's inbox.
 *
 *  A note the reader chose is kept by path and follows the note, so a renamed inbox
 *  stays the inbox: the file operation that renamed it says so
 *  (workspace/file-ops.ts), the way a bookmark follows. A space whose inbox is Orden's
 *  own keeps nothing here. */

import { carriedOwn, INBOX_PATH } from '@orden/bases/inbox'
import { insideItsSpace, insideSpace, movedTo, relativeTo, samePath } from '../space-paths'
import { readIfThere } from '../read-if-there'
import { without } from '../records'
import { forget, isRecord, isString, keepJson, stored } from '../stored'
import { invoke, isDesktop, platform } from '../tauri'
import type { KeptByPath } from '../workspace/file-ops'

export const STORAGE_KEY = 'nib:inbox'

/** The inbox of a space that says nothing else: Orden's own, `INBOX_PATH`. */
export const INBOX = INBOX_PATH

/** The note Orden made at a space's root for its inbox before #1044, which
 *  inbox-move.ts takes in where the reader never made it theirs. */
export const OLD_INBOX = 'Inbox.md'

/** Whether a path inside a space is its own inbox, Orden's rather than a note. */
export const isInternalInbox = carriedOwn

/** Every space's own inbox, by root, relative to it. */
function read(): Record<string, string> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}
  const out: Record<string, string> = {}
  for (const [root, path] of Object.entries(saved)) {
    if (isString(path) && insideItsSpace(path)) out[root] = path
  }
  return out
}

function write(all: Record<string, string>) {
  if (Object.keys(all).length) keepJson(STORAGE_KEY, all)
  else forget(STORAGE_KEY)
}

/** The root a record is kept under that names this space, spelled as it was kept. */
function keyOf(all: Record<string, string>, root: string): string | undefined {
  return Object.keys(all).find((one) => samePath(one, root))
}

/** The note the reader chose as a space's inbox, relative to it; null where the
 *  space's inbox is Orden's own. */
export function chosenInbox(root: string): string | null {
  const all = read()
  const key = keyOf(all, root)
  return (key === undefined ? undefined : all[key]) ?? null
}

/** The inbox of a space, relative to it. */
export function inboxOf(root: string): string {
  return chosenInbox(root) ?? INBOX
}

/** Makes a note of the reader's the space's inbox; Orden's own again where it is
 *  `INBOX`. */
export function setInbox(root: string, relative: string) {
  const kept = read()
  const key = keyOf(kept, root)
  const all = key === undefined ? kept : without(kept, key)
  write(isInternalInbox(relative) ? all : { ...all, [root]: relative })
  if (front !== null && samePath(front, root)) rememberInbox(root)
}

/** The space in front, whose inbox the crate was last told. */
let front: string | null = null

/** The space whose inbox a task from Shortcuts goes to: the one in front where it can
 *  be written in, else the first that can, else none. The crate writes the task
 *  straight onto the disk and knows nothing of who may write where, so a space shared
 *  to be read is never named to it; and one is named even with nothing in front,
 *  since what the crate falls back to is the first space on disk, whatever it is. */
export function inboxSpace(
  active: string | null,
  roots: readonly string[],
  writable: (root: string) => boolean,
): string | null {
  if (active !== null && writable(active)) return active
  return roots.find(writable) ?? null
}

/** Tells the crate which note is the inbox of the space in front, which is where a task
 *  added from Shortcuts goes: the crate cannot read local storage, and the app may not
 *  even be open when one comes. Only a Mac has the action; see src-tauri/src/siri.rs. */
export function rememberInbox(root: string | null) {
  front = root
  if (root === null || !isDesktop || platform() !== 'macos') return
  void invoke('remember_inbox', { path: insideSpace(root, inboxOf(root)) }).catch(() => undefined)
}

/** The space's inbox as a path on this disk, made empty where there is none yet.
 *  Throws `Unreadable` for an inbox that is there and would not read. */
export async function ensureInbox(
  root: string,
  made: (path: string) => Promise<void>,
): Promise<string> {
  const path = insideSpace(root, inboxOf(root))
  // Read, and the disk asked only where the read failed: an inbox that is there and
  // would not read fails the read too, and one made over it would be a note emptied
  // with the task landing in what is left.
  const there = await readIfThere(path)
  if (there === null) await made(path)
  return path
}

/** The inbox follows its note: renamed, moved, or its space renamed or gone. */
export const inboxes: KeptByPath = {
  moved(from, to, root) {
    if (root === null) return
    const now = inboxOf(root)
    const was = relativeTo(root, from)
    const after = movedTo(now, was, relativeTo(root, to), root)
    if (after !== null) setInbox(root, after)
  },
  spaceMoved(from, to) {
    const all = read()
    const key = keyOf(all, from)
    const kept = key === undefined ? undefined : all[key]
    if (key === undefined || kept === undefined) return
    write({ ...without(all, key), [to]: kept })
  },
  forget(root) {
    const all = read()
    const key = keyOf(all, root)
    if (key === undefined) return
    write(without(all, key))
  },
}
