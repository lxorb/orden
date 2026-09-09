/** What the picker remembers between openings: which set was last open, and the
 *  icons that were last chosen.
 *
 *  Both are about the person rather than about the thing wearing the icon, so
 *  neither belongs in a note, in a space or on the account - this device, this
 *  person, the drawer they last had open. Which is also why they are here rather
 *  than in the component: a sheet that is mounted once and shut every time it is
 *  used has nowhere to keep anything.
 *
 *  A row of the last few is most of what makes a set of thousands usable. Somebody
 *  marking a month of folders reaches for the same eight icons, and reaching for them
 *  should not mean typing the same eight words again. */

import { isString, stored, stringList } from './stored'

const RECENT_KEY = 'nib:icons-recent'
const SET_KEY = 'nib:icon-set'

/** How many are kept. One row of them at the width the sheet is, and no scrollbar:
 *  a second row of recent icons is a second grid, and the grid is below. */
const MOST_RECENT = 12

function lastSet(): string {
  const said = stored(SET_KEY)
  return isString(said) ? said : ''
}

class IconRecent {
  /** The written values, most recently chosen first. */
  list = $state<string[]>(stringList(stored(RECENT_KEY))?.slice(0, MOST_RECENT) ?? [])

  /** The set the picker opens on: the one it was last left on, so somebody who
   *  works in emoji is not put back into the line set every time. Empty until one
   *  has been left, which the picker reads as its own default. */
  set = $state<string>(lastSet())

  /** One that has just been chosen, moved to the front. Taking an icon away is not
   *  choosing one, so `null` is not remembered. */
  add(value: string | null) {
    if (!value) return

    this.list = [value, ...this.list.filter((one) => one !== value)].slice(0, MOST_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.list))
  }

  open(set: string) {
    if (this.set === set) return

    this.set = set
    localStorage.setItem(SET_KEY, set)
  }
}

export const iconRecent = new IconRecent()
