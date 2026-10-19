/** Two copies of a note made one again, where the two edits meet nowhere: the half
 *  of a three-way merge sync v1 trusts (docs/sync.md, "Signing back in"). Its own
 *  file, fetched with the first note both sides wrote in, because the diff under it is
 *  weight nothing else of a pass needs - and the glasses' plugin, whose package must
 *  stay small, never fetches it at all and keeps both copies as it always has. */

import { diverge } from '@nib/sync-core/diverge'

/** The two copies as one note, when they meet nowhere: every edit either side made
 *  since `base` kept, an edit both made once. Null where they overlap, or where the
 *  merge would break something both kept (front matter, a fence), which is the
 *  conflict rule's to settle. */
export function mergedCleanly(base: string, local: string, remote: string): string | null {
  const judged = diverge(base, local, remote, { local: 0, remote: 0 })
  return judged.verdict === 'clean' ? judged.resolution : null
}
