/** Whole spaces put away (#352): which of this device's spaces are archived, by the
 *  folder each is. An archived space is out of every list of spaces - the switcher, the
 *  picker in the middle of the window, the keys that step through spaces, the palette's,
 *  Move to space - and its files out of every list that reads across the spaces: Today,
 *  the Tasks panel and the bases (rows/rows.svelte.ts), the glasses'. Nothing is moved
 *  or deleted and its sync goes on as before; taking it back puts it where it was in the
 *  order. A space the account has is archived on the account too, so every device agrees;
 *  that half, and the gestures, are space-archive.ts. Kept by folder, as a device names
 *  a space, under one key of its own. */

import { samePath } from '../space-paths'
import { keep, stored, stringList } from '../stored'

const KEY = 'nib:archived-spaces'

/** Far past anybody's spaces, and a ceiling on what a stored list may hold. */
const MOST = 500

export class ArchivedSpaces {
  /** The folders of the spaces put away. Replaced whole on every change. */
  roots = $state.raw<readonly string[]>(stringList(stored(KEY))?.slice(0, MOST) ?? [])

  /** Whether the space in this folder is put away. */
  has(root: string): boolean {
    return this.roots.some((one) => samePath(one, root))
  }

  /** Puts the space in this folder away, or takes it back. Answers whether anything
   *  changed. */
  set(root: string, archived: boolean): boolean {
    if (this.has(root) === archived) return false
    this.roots = archived
      ? [...this.roots, root].slice(-MOST)
      : this.roots.filter((one) => !samePath(one, root))
    keep(KEY, JSON.stringify(this.roots))
    return true
  }
}
