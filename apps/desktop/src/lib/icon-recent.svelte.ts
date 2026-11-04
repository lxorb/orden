/** What the picker remembers between openings: the icons that were last chosen.
 *
 *  That is about the person rather than about the thing wearing the icon, so
 *  neither belongs in a note, in a space or on the account - this device, this
 *  person, the drawer they last had open. Which is also why they are here rather
 *  than in the component: a sheet that is mounted once and shut every time it is
 *  used has nowhere to keep anything.
 *
 *  A row of the last few is most of what makes a set of thousands usable. Somebody
 *  marking a month of folders reaches for the same eight icons, and reaching for them
 *  should not mean typing the same eight words again. */

import { forget, keepJson, stored, stringList } from './stored'

const RECENT_KEY = 'nib:icons-recent'

/** Where the picker kept the tab it was last left on, before the tabs went (#1096):
 *  nothing reads it now, so it is taken away once this is loaded. */
const OLD_SET_KEY = 'nib:icon-set'
forget(OLD_SET_KEY)

/** How many are kept. One row of them at the width the sheet is, and no scrollbar:
 *  a second row of recent icons is a second grid, and the grid is below. */
const MOST_RECENT = 12

class IconRecent {
  /** The written values, most recently chosen first. */
  list = $state<string[]>(stringList(stored(RECENT_KEY))?.slice(0, MOST_RECENT) ?? [])

  /** One that has just been chosen, moved to the front. Taking an icon away is not
   *  choosing one, so `null` is not remembered. */
  add(value: string | null) {
    if (!value) return

    this.list = [value, ...this.list.filter((one) => one !== value)].slice(0, MOST_RECENT)
    keepJson(RECENT_KEY, this.list)
  }
}

export const iconRecent = new IconRecent()
