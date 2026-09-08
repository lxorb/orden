/** The one decision joining a room comes down to.
 *
 *  A device arrives holding a file, and the room holds words of its own. When the
 *  two disagree, exactly one of them is carrying something the other has not seen,
 *  and which one it is has a short answer: is the file still byte for byte what the
 *  account last handed this device? If it is, then whatever differs was written
 *  elsewhere and the room is simply ahead. If it is not, this device wrote while it
 *  was away and the room has never heard it.
 *
 *  Written as a rule rather than as steps, so that it can be read on its own and
 *  tested against pairs of texts. Carrying it out is the room's; see room.ts. */

import { fold, type Replacement } from '@nib/rooms/fold'

export type Meeting =
  /** The two already say the same thing. */
  | { kind: 'agreed' }
  /** The room is ahead. Its words go into the note, as the edit they are, so every
   *  pane keeps its caret and the note is written to disk at the next pause. */
  | { kind: 'take'; change: Replacement }
  /** This device is ahead. What it wrote goes into the room, where it is settled
   *  against whatever anybody else did meanwhile. */
  | { kind: 'offer'; change: Replacement }

/** `untouched` says whether the file is still exactly what the account last handed
 *  this device. False for a note with no hash to compare against, which is a note
 *  that has never been synced and so has nothing but its own words. */
export function meeting(mine: string, theirs: string, untouched: boolean): Meeting {
  if (mine === theirs) return { kind: 'agreed' }

  // A room with nothing in it has nothing to say. That is what a room looks like
  // before it has been given the note, and no device is ever asked to empty its
  // own file for one.
  if (!theirs) return { kind: 'offer', change: { from: 0, to: 0, insert: mine } }

  const change = untouched ? fold(mine, theirs) : fold(theirs, mine)
  // Two texts that differ always differ somewhere; the null is the compiler's
  // case rather than one that happens.
  if (!change) return { kind: 'agreed' }

  return untouched ? { kind: 'take', change } : { kind: 'offer', change }
}
