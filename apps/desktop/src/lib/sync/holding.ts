/** Whether the account holds what a file on this disk is now, under the first sync:
 *  what a delete leans on to go to the account outright rather than to this device's
 *  trash.
 *
 *  Being in the mirror is not enough. The mirror says what the last pass handed the
 *  account, and a paper highlighted or replaced since, or a note typed into offline, is
 *  bytes the account has never seen: deleted outright, Recently deleted gave back the
 *  copy from before. So the file is read and its hash compared with the one the mirror
 *  wrote down, and anything that cannot be told for certain answers no, which sends the
 *  delete to the trash, where nothing is lost either way.
 *
 *  Fetched with the first delete that asks, so the hashing stays out of the window's
 *  first load. See test/weight.test.ts. */

import { sha256 } from '../bytes'
import { invoke } from '../tauri'
import type { Mirror } from './mirror'

/** What asking whether the account holds a file may lean on besides the file itself.
 *
 *  `modified` is when a folder's listing saw the file last written, which spares a
 *  paper nobody has touched being read at all. `budget` is how many bytes a check over
 *  a whole folder may still read: a folder of thousands of notes is not worth reading
 *  through to delete, and once the allowance is spent the answer is no, which sends
 *  the folder to this device's trash rather than losing anything. A single file asked
 *  about on its own has none, and is read whole. */
export interface Holding {
  modified?: number
  budget?: { left: number }
}

/** Takes what was read off a folder check's allowance; false once it is spent. */
export function spend(how: Holding, size: number): boolean {
  if (!how.budget) return true
  how.budget.left -= size
  return how.budget.left >= 0
}

/** Whether the account holds the file at `relative` in a mirror as it is on disk at
 *  `path`. */
export async function mirrorHolds(
  mirror: Mirror,
  relative: string,
  path: string,
  how: Holding,
): Promise<boolean> {
  const note = mirror.notes[relative]
  if (note) {
    // Handed over and not answered yet: the account may or may not have it.
    if (mirror.offered[relative] !== undefined) return false
    const words = await invoke<string>('read_note', { path }).catch(() => null)
    if (words === null || !spend(how, words.length)) return false
    return sameWords(words, note.hash)
  }

  const file = mirror.files[relative]
  if (!file) return false
  // Not written since the pass hashed it, which is the pass's own test for whether
  // a paper is worth reading again (`pushFiles` in pass.ts).
  if (how.modified !== undefined && how.modified === file.modified) return true
  // Inside a folder, a paper written since is tens of megabytes to read for an
  // answer that the trash makes safe without it.
  if (how.budget) return false
  const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
  return bytes !== null && (await sha256(bytes)) === file.hash
}

/** Whether a note's words are the ones a hash was taken of, in either line ending, as
 *  the pass compares them (`holdsSameWords` in pass.ts). */
async function sameWords(words: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if ((await sha256(words)) === hash) return true
  return words.includes('\r') && (await sha256(words.replace(/\r\n/gu, '\n'))) === hash
}
