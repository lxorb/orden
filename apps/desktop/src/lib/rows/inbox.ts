import { ACCOUNT_INBOX, INBOX_PATH, markedInbox } from '@orden/bases/inbox'
import { without } from '../records'
import { insideItsSpace, samePath } from '../space-paths'
import { forget, isRecord, isString, keepJson, stored } from '../stored'

const STORAGE_KEY = 'orden:inbox'

export const INBOX = ACCOUNT_INBOX

export const LEGACY_INBOX = INBOX_PATH

export const OLD_INBOX = 'Inbox.md'

function read(): Record<string, string> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}
  const out: Record<string, string> = {}
  for (const [root, path] of Object.entries(saved)) {
    if (isString(path) && insideItsSpace(path)) out[root] = path
  }
  return out
}

function keyOf(all: Record<string, string>, root: string): string | undefined {
  return Object.keys(all).find((one) => samePath(one, root))
}

export function pickedInbox(
  root: string,
  notes: Iterable<readonly [string, Readonly<Record<string, string>> | null | undefined]>,
): string | null {
  const all = read()
  const key = keyOf(all, root)
  const own = key === undefined ? undefined : all[key]
  if (own !== undefined && !samePath(own, LEGACY_INBOX, root)) return own
  return markedInbox(notes)
}

export function forgetPicked(root: string): void {
  const all = read()
  const key = keyOf(all, root)
  if (key === undefined) return
  const left = without(all, key)
  if (Object.keys(left).length) keepJson(STORAGE_KEY, left)
  else forget(STORAGE_KEY)
}
