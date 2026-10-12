/** Where a copy on this device stands against the account's: behind it, or beside it.
 *
 *  Git's question, asked of one note. A copy that is word for word something the note
 *  once said holds nothing the account has not seen, so it is brought up to date
 *  rather than kept as a second copy. And where both sides wrote since the words they
 *  last agreed on, those words are the base a three-way merge is made against: two
 *  edits that meet nowhere are one note again, and only edits that overlap are left to
 *  the conflict rule. See docs/sync.md, "Signing back in".
 *
 *  Every answer here is a narrowing of what was done before, never a widening: a
 *  question that cannot be answered - the network, a base nobody kept - answers that
 *  the copy is beside the account's, which is the conflict copy it always was. */

import { diverge } from '@nib/sync-core/diverge'
import { api } from '../api'
import { sha256 } from '../bytes'
import { invoke } from '../tauri'

/** The most notes one question to the account names; `MOST_ASKED` in the Worker's
 *  notes.ts. */
const AT_ONCE = 100

/** How many of the device's own versions of a note are read looking for the base:
 *  the newest few, which is where the moment both sides last agreed almost always
 *  is - the first save after a pass keeps the words the pass left. */
const LOOKED_AT = 12

/** A text with Windows line endings read the way the account holds it: a file that
 *  was on this machine before keeps them whenever the app writes it (`as_written` in
 *  src-tauri/src/notes.rs), and the same words are the same words. */
export function unixLines(text: string): string {
  return text.replace(/\r\n/gu, '\n')
}

/** The notes whose copy here is only behind the account's, by id. */
export async function behind(
  token: string,
  copies: readonly { id: string; hash: string }[],
): Promise<Set<string>> {
  const found = new Set<string>()
  for (let at = 0; at < copies.length; at += AT_ONCE) {
    const asked = await api.said(token, copies.slice(at, at + AT_ONCE)).catch(() => ({ said: [] }))
    for (const id of asked.said) found.add(id)
  }
  return found
}

interface Snapshot {
  path: string
}

/** The words a note said when they hashed to `hash`: out of this device's own versions
 *  first, which cost no request, then the account's. Null when neither kept them. */
export async function baseOf(
  token: string,
  path: string,
  id: string,
  hash: string,
): Promise<string | null> {
  if (!hash) return null

  const kept = await invoke<Snapshot[]>('list_snapshots', { path }).catch(() => [])
  for (const one of kept.slice(0, LOOKED_AT)) {
    const text = await invoke<string>('read_snapshot', { path: one.path, notePath: path }).catch(
      () => null,
    )
    if (text !== null && (await sha256(text)) === hash) return text
  }

  const held = await api.saidAs(token, id, hash).catch(() => null)
  return held?.content ?? null
}

/** The two copies as one note, when they meet nowhere: every edit either side made
 *  since `base` kept, an edit both made once. Null where they overlap, or where the
 *  merge would break something both kept (front matter, a fence), which is the
 *  conflict rule's to settle. */
export function mergedCleanly(base: string, local: string, remote: string): string | null {
  const judged = diverge(base, local, remote, { local: 0, remote: 0 })
  return judged.verdict === 'clean' ? judged.resolution : null
}
