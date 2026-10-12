/** Whether signing in asks anything about the notes already on this device.
 *
 *  Signing back in is not meeting an account for the first time. A device that was
 *  last in step with this very account kept what it knew - each note's version and
 *  the hash of the words the last pass left - and a pass resumes from there the way
 *  Git fast-forwards: a note only the account moved comes down, a note only this
 *  device moved goes up, and a note both moved is merged where the two edits meet
 *  nowhere and kept beside where they overlap. Nothing in that is a question.
 *
 *  Only notes of unknown standing can be: another account's, or ones no pass has seen.
 *  Even those are asked about only where joining the account would put two different
 *  texts at one path - a copy that is word for word one the account once held is just
 *  behind it, and a space of a name the account does not have collides with nothing.
 *  The answers are Merge and Keep separate; neither throws anything away. See
 *  docs/sync.md, "Signing back in", and the decision table there. */

/** Whose the device's record of where it left off is, by the account signing in. */
export type Base = 'mine' | 'other' | 'none'

export function baseFor(
  saved: { whose: string | null; mirrors: Record<string, unknown> } | null,
  account: string,
): Base {
  // Nothing written down, or a record of no space at all: no pass ever paired a
  // folder here with anything.
  if (!saved || !Object.keys(saved.mirrors).length) return 'none'
  // Written by a version from before mirrors named their account: whoever signs in,
  // which is how the loop has always read it.
  if (saved.whose === null || saved.whose === account) return 'mine'
  return 'other'
}

/** Whether to ask. `meets` is whether some space here would meet different words at
 *  a path the account's space of that name also has; it is only worked out where the
 *  base leaves it open. */
export function asksOnReturn(base: Base, meets: boolean): boolean {
  return base !== 'mine' && meets
}

/** The first `Name 2`, `Name 3`… nobody has taken: what a space kept separate is
 *  called, so it no longer pairs with the account's space of its old name. */
export function apartName(name: string, taken: ReadonlySet<string>): string {
  let counter = 2
  while (taken.has(`${name} ${counter}`)) counter += 1
  return `${name} ${counter}`
}
