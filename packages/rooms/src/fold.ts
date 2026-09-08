/** Folding a text that was written while away into the one the room holds.
 *
 *  A device that was closed, or offline, or whose note was edited by some other
 *  program, comes back holding words the room has never seen. It cannot simply
 *  take the room's copy, which would throw that writing away, and it cannot push
 *  its own, which would throw away whatever anyone else wrote meanwhile. What it
 *  does instead is say what changed: the two texts agree at the front and at the
 *  back, and the piece in the middle is the edit. Applied to the shared text that
 *  is an ordinary edit, made now, on top of everything the room already has - so
 *  both sides survive and nobody ends up with a second file to go and find.
 *
 *  A run of keystrokes made while connected never comes through here; those are
 *  merged character by character by the CRDT itself. This is the coarser answer
 *  for the case where there is no shared history to merge with. */

export interface Replacement {
  from: number
  to: number
  insert: string
}

/** Whether the code unit at `at` is the first half of a pair that stands for one
 *  character. Cutting between the two halves would leave both texts holding half
 *  a character each. */
function leadsPair(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xd800 && code <= 0xdbff
}

/** What to change in `held` so that it reads as `mine`: one replacement, the
 *  common front and back trimmed away. Null when the two already agree.
 *
 *  One replacement rather than a line diff on purpose. The middle is whatever
 *  the two texts do not share, which for the usual case - a paragraph written on
 *  a phone in a tunnel - is that paragraph and nothing else; and where the two
 *  really have little in common, one replacement is the honest summary. */
export function fold(held: string, mine: string): Replacement | null {
  if (held === mine) return null

  const shortest = Math.min(held.length, mine.length)

  let front = 0
  while (front < shortest && held.charCodeAt(front) === mine.charCodeAt(front)) front++
  // Never between the halves of one character.
  if (front > 0 && leadsPair(held, front - 1)) front--

  let back = 0
  while (
    back < shortest - front &&
    held.charCodeAt(held.length - 1 - back) === mine.charCodeAt(mine.length - 1 - back)
  ) {
    back++
  }
  // The shared back begins at `held.length - back`, so what would leave half a
  // character behind is the unit before it being the first half of a pair: the
  // change would then end between the two, keeping the second half and replacing
  // the first. One fewer, and both halves are inside the change.
  if (back > 0 && leadsPair(held, held.length - back - 1)) back--

  return { from: front, to: held.length - back, insert: mine.slice(front, mine.length - back) }
}
