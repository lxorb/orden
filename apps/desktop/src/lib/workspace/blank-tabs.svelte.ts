/** A new tab nothing was done with goes once it is left (#1040); which tab that is and
 *  how it goes is `isBlankTab` and `closeLeftBlank` in workspace.svelte.ts. This is when:
 *  after every change of the tab being worked in - another tab, another pane, another
 *  space, something opened elsewhere - a turn late, so the address field of the tab left
 *  has said what was half typed into it as it let go of the keyboard. Never while the tab
 *  overview is up, whose windows the tabs are (#331): a window that went from under the
 *  pointer while it chose would be a jump; what was left goes as the overview does.
 *
 *  Started at the launch's last turn on the desktop; see start.ts. */

import { tabOverview } from '../surfaces.svelte'
import { workspace } from '../workspace.svelte'

$effect.root(() => {
  $effect(() => {
    // What is being worked in, and how many tabs there are to look at.
    const watched = `${workspace.activeTabId}:${workspace.activeSpaceId}:${workspace.tabs.length}`
    if (tabOverview.open || !watched) return

    const timer = setTimeout(() => workspace.closeLeftBlank(), 0)
    return () => clearTimeout(timer)
  })
})
