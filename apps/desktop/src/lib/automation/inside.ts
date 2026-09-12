/** Whether a path somebody else wrote may be joined to a space at all.
 *
 *  This is the one check between a link and the disk. A `nib://` link can be
 *  written by anybody - a page, a note, a message - so the path in it is not a
 *  path until it has been read here, and a request over the local endpoint is
 *  judged by exactly the same function: one rule, so a hole in one road is not a
 *  hole the other road quietly does not have.
 *
 *  Pure, and it says no by answering null rather than by throwing: every caller
 *  has somewhere to put a refusal on screen. */

/** The highest code point no file name holds. Below it are the control
 *  characters: the NUL a name is smuggled past a reader with, and the newline
 *  that would make one path read as two. */
const CONTROL = 0x20

/** Delete, which is not a control character by code but is not part of a name
 *  either. */
const DELETE = 0x7f

/** A path as the space speaks of it: relative to the root, `/` separators, no
 *  `..` and nothing that was never part of a file name. Null for a path this
 *  space has no business joining.
 *
 *  What is refused, and why each one:
 *
 *  - a path that is already absolute: a drive letter, a leading separator, a UNC
 *    name. The caller is saying where in the space to look, and a path of its own
 *    is a path outside it.
 *  - `..` as a step. One of those is how every escape from a folder is written,
 *    and a path holding one is never a path somebody meant.
 *  - a character no name holds; see above.
 *  - a name Windows keeps for a device, so a path that works on one machine works
 *    on the reader's other ones too. The crate refuses these when a space is made
 *    or a file is put back; this is the same list on this side of the bridge.
 *  - nothing at all, and a path that is only separators and dots. */
export function insideOnly(said: string): string | null {
  const folded = said.replace(/\\/g, '/').trim()
  if (!folded) return null

  // Absolute, in each of the three shapes a platform writes one.
  if (folded.startsWith('/') || /^[A-Za-z]:/.test(folded)) return null
  if (holdsUnnameable(folded)) return null

  const steps = folded.split('/').filter((step) => step !== '' && step !== '.')
  if (!steps.length) return null
  if (steps.some((step) => step === '..')) return null
  if (steps.some(isReserved)) return null

  return steps.join('/')
}

/** Whether any character in it is one a file name cannot hold. Asked by code
 *  point rather than by a pattern, so that the characters this is about are not
 *  themselves written into the source. */
function holdsUnnameable(path: string): boolean {
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0
    if (code < CONTROL || code === DELETE) return true
  }

  return false
}

/** Names Windows refuses whatever the extension, because each names a device
 *  rather than a file. The same list as `RESERVED` in src-tauri/src/paths.rs, and
 *  asked on every platform for the reason given there: a note has to be able to
 *  land on all of the reader's machines. */
const RESERVED = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]

/** Whether a step names a device, going by the part in front of the first dot,
 *  which is where Windows looks: `NUL.md` names the device as surely as `NUL`. */
function isReserved(step: string): boolean {
  const stem = step.split('.')[0] ?? step
  return RESERVED.includes(stem.toUpperCase())
}
