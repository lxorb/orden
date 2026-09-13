/** The one decision joining a room comes down to.
 *
 *  A device arrives holding a file, and the room holds words of its own. When the
 *  two disagree, the question is which of them is carrying something the other has
 *  not seen, and the only thing that can answer it is the copy they both started
 *  from: the words the account last handed this device.
 *
 *  So there are three answers rather than two. If the file here is still that copy,
 *  whatever differs was written elsewhere and the room is simply ahead. If the room
 *  still holds that copy, this device wrote while it was away and the room has never
 *  heard it. And if neither of them is that copy any more, both of them wrote while
 *  they were apart - and then nothing here may be written over anything, because one
 *  replacement cannot say "keep both of these".
 *
 *  That third answer is the one this file was missing, and its absence was silent
 *  data loss. A device that came back holding a file - the app restarted, the tab
 *  reopened, a note edited by some other program - was read as simply ahead, and
 *  what it offered was `fold(theirs, mine)`: the one replacement that makes the room
 *  read exactly as this file. Which deletes, as an ordinary edit in the shared
 *  document, every word the room had and the file did not. The delete then travelled
 *  to every other device in the room, the room settled it into the account, and
 *  somebody's paragraph was gone from their own screen, their own disk and the
 *  account, with nothing said and no copy anywhere. Both sides were inside the rule
 *  the whole time, which is why the guard belongs here in the rule.
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
  /** Both wrote since the words they shared, so neither copy may be written over.
   *  What happens instead is the conflict rule's to say, not a room's; see
   *  apart.ts and sync/conflicts.ts. */
  | { kind: 'apart' }

/** Which of the two texts is still exactly the copy the account last handed this
 *  device - the words both sides started from.
 *
 *  Both can be false, which is the whole point: that is two sides that have each
 *  moved on. Both being true cannot happen for texts that differ, and reads as
 *  `agreed` before either is asked. */
export interface Base {
  /** The file here has not been written in since the account handed it over. */
  mine: boolean
  /** The room holds nothing this device has not already been handed. */
  theirs: boolean
}

/** `base` is null for a file the account has never handed this device at all - one
 *  somebody shared on its own, whose words live in the room and nowhere else here.
 *  There is no copy to compare against and nothing of this device's to lose, so the
 *  room is taken as the truth. */
export function meeting(mine: string, theirs: string, base: Base | null): Meeting {
  if (mine === theirs) return { kind: 'agreed' }

  // A room with nothing in it has nothing to say. That is what a room looks like
  // before it has been given the note, and no device is ever asked to empty its
  // own file for one.
  if (!theirs) return { kind: 'offer', change: { from: 0, to: 0, insert: mine } }

  // And a device with nothing to say may not ask the room to empty itself. An
  // empty document is a tab that has not been filled in yet, not somebody deleting
  // a note: deleting a note is the file going, which is a pass's business.
  if (!mine) return { kind: 'take', change: { from: 0, to: 0, insert: theirs } }

  // The room is ahead: everything that differs was written somewhere else, and
  // taking it loses nothing, because this file is still the copy it was handed.
  if (base === null || base.mine) return answer('take', fold(mine, theirs))

  // This device is ahead: the room still holds the copy this device was handed, so
  // making it read as this file takes nothing away from it.
  if (base.theirs) return answer('offer', fold(theirs, mine))

  return { kind: 'apart' }
}

/** Two texts that differ always differ somewhere; the null is the compiler's case
 *  rather than one that happens. */
function answer(kind: 'take' | 'offer', change: Replacement | null): Meeting {
  return change ? { kind, change } : { kind: 'agreed' }
}
