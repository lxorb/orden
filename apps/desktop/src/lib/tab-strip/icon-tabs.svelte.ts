/** Whether every tab but the one being read is drawn as its mark alone (#1041): on out of
 *  the box, and a switch under Tabs in General.
 *
 *  Emil, 2026-11-03: *"bis auf den aktuell ausgewählten Tab jeder Tab einfach nur sein
 *  Icon hat und keinen Titel. Praktisch so als wäre er angepinnt."* A tab the pointer
 *  rests on opens out to its name at once, and closes again when the pointer leaves;
 *  see `widened` in layout.ts and Tabs.svelte. Which is why the strip lost its pinning:
 *  every tab not in front looks pinned now. Kept on this device through stored.ts. */

import { keep, storedText } from '../stored'

const KEY = 'nib:icon-tabs'

class IconTabs {
  on = $state(storedText(KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}

export const iconTabs = new IconTabs()

/** Whether a tab is only as wide as its mark, its name and its close button need, rather
 *  than every tab taking the standard width while the strip has the room (#1114): on out
 *  of the box, and a switch under Tabs in General. The tabs still shrink as they do when
 *  the room runs out; see `fitted` and `widthsFor` in layout.ts.
 *
 *  Emil, 2026-11-04: an active "Orden" tab beside one icon tab was far wider than its
 *  name needs. Kept on this device through stored.ts. */
const FIT_KEY = 'nib:fit-tabs'

class FitTabs {
  on = $state(storedText(FIT_KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(FIT_KEY, on ? 'yes' : 'no')
  }
}

export const fitTabs = new FitTabs()
