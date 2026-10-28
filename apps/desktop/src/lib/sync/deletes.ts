/** What sync takes off this disk, and where it goes (#765).
 *
 *  Sync removes a file when the account says it went: another device deleted it, or a
 *  day's note made on two devices became one and this device's copy is the one that
 *  went into the other, or another program's copy of a web note was folded into it.
 *  It used to put every one of those in this device's Recently deleted. But sync only
 *  runs signed in, and signed in a note somebody deletes goes to the account's
 *  Recently deleted, not this device's (`deleteEntry` in workspace.svelte.ts) - so a
 *  note deleted on a phone was in the laptop's Recently deleted twice over, and a day's
 *  note nobody deleted at all was there once. A reader on a fresh install found
 *  "history" there they never made.
 *
 *  So sync deletes the way a reader signed in does: a version of the words kept, and the
 *  file gone, where the account's Recently deleted holds it. What that does not hold
 *  still goes to this device's: a folder, which may hold files that never travel; a page
 *  note, whose paper only this device's trash keeps beside it; and a file that is not a
 *  note's words - a picture, a PDF - which the account keeps only as a version. */

import { isPagesTarget } from '@nib/markdown/links'
import { kindOfName } from '@orden/sync-core/tree'
import type { FileKind } from '../sync2/world'

/** Whether sync deletes this outright rather than putting it in this device's trash. */
export function syncDeletes(path: string, kind: FileKind): boolean {
  if (kind === 'folder' || isPagesTarget(path)) return false
  return kindOfName(path) !== 'file'
}
