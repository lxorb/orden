/** Whether this browser is on its first visit: the one that wrote the welcome note, so
 *  nothing here is anybody's yet. Nothing is asked (fresh-start.ts); what waits on it is
 *  the old address's handoff, which may only write over a browser that holds nothing
 *  (web/taking-over.svelte.ts). Remembered as answered once the handoff came, since a
 *  browser a drive opens is a first visit every time; see test/e2e/handoff.py. */

import { keep, storedText } from './stored'

const KEY = 'nib:first-visit'

class FirstVisit {
  fresh = $state(false)

  /** Said by the visit that wrote the welcome note. */
  seeded() {
    if (storedText(KEY) !== 'answered') this.fresh = true
  }

  answered() {
    this.fresh = false
    keep(KEY, 'answered')
  }
}

export const firstVisit = new FirstVisit()
