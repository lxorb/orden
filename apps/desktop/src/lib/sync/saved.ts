/** What `nib:mirrors` holds, as written down: in the wrapper a newer version writes or
 *  bare as an older one did. The one reading of it, for sync.svelte.ts at launch and
 *  for what reads it later and should not cost the launch a byte: the Sync pane's
 *  count of other tools' copies (foreign/synced.ts), v2's first pass, which reads the
 *  same rows its own way, and a sign-in telling an account coming back from one
 *  arriving for the first time (settling.ts). */

import { isRecord } from '../stored'
import { type Mirror, readMirror } from './mirror'

export const MIRRORS_KEY = 'nib:mirrors'

/** This machine's record of where it is with an account. */
export interface Saved {
  /** Whose it is. Null in what a version from before accounts wrote, which belongs to
   *  whoever signs in. */
  whose: string | null
  /** Whether a pass ever finished. */
  seen: boolean
  mirrors: Record<string, Mirror>
}

/** The record, or null where nothing that reads as one was written. */
export function savedRecord(saved: unknown): Saved | null {
  if (!isRecord(saved)) return null

  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  const mirrors: Record<string, Mirror> = {}
  for (const [root, one] of Object.entries(held)) {
    const mirror = readMirror(root, one)
    if (mirror) mirrors[root] = mirror
  }

  return {
    whose: typeof saved.account === 'string' ? saved.account : null,
    // Absent in what an older version wrote. A machine that has mirrors from before
    // this field existed has plainly seen the account, and reading it as unseen would
    // hold the app back once, on the next launch only.
    seen: saved.seen === true || Object.keys(mirrors).length > 0,
    mirrors,
  }
}

/** Every mirror the record holds for an account, and none of another account's. */
export function savedMirrors(saved: unknown, accountId: string | null): Mirror[] {
  const record = savedRecord(saved)
  if (!record || (record.whose !== null && record.whose !== accountId)) return []
  return Object.values(record.mirrors)
}
