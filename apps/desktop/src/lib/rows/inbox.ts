import { carriedOwn, INBOX_PATH } from '@orden/bases/inbox'
import { insideItsSpace, insideSpace, movedTo, relativeTo, samePath } from '../space-paths'
import { readIfThere } from '../read-if-there'
import { without } from '../records'
import { forget, isRecord, isString, keepJson, stored } from '../stored'
import type { KeptByPath } from '../workspace/file-ops'

export const STORAGE_KEY = 'nib:inbox'

export const INBOX = INBOX_PATH

export const OLD_INBOX = 'Inbox.md'

export const isInternalInbox = carriedOwn

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

function keyOf(all: Record<string, string>, root: string): string | undefined {
  return Object.keys(all).find((one) => samePath(one, root))
}

export function chosenInbox(root: string): string | null {
  const all = read()
  const key = keyOf(all, root)
  return (key === undefined ? undefined : all[key]) ?? null
}

export function inboxOf(root: string): string {
  return chosenInbox(root) ?? INBOX
}

export function setInbox(root: string, relative: string) {
  const kept = read()
  const key = keyOf(kept, root)
  const all = key === undefined ? kept : without(kept, key)
  write(isInternalInbox(relative) ? all : { ...all, [root]: relative })
  for (const one of choosing) one(root)
}

const choosing = new Set<(root: string) => void>()

export function hearInboxChosen(then: (root: string) => void): () => void {
  choosing.add(then)
  return () => choosing.delete(then)
}

export async function ensureInbox(
  root: string,
  made: (path: string) => Promise<void>,
): Promise<string> {
  const path = insideSpace(root, inboxOf(root))
  const there = await readIfThere(path)
  if (there === null) await made(path)
  return path
}

export const inboxes: KeptByPath = {
  moved(from, to, root, into) {
    if (root === null) return
    const now = inboxOf(root)
    const was = relativeTo(root, from)
    const after = movedTo(now, was, relativeTo(root, to), root)
    if (after === null) return
    setInbox(root, into !== undefined && into !== null && !samePath(into, root) ? INBOX : after)
  },
  gone(path, root) {
    if (root === null) return
    const chosen = chosenInbox(root)
    if (chosen !== null && movedTo(chosen, relativeTo(root, path), '', root) !== null) {
      setInbox(root, INBOX)
    }
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
