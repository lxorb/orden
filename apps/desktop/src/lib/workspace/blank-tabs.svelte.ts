import { tabOverview } from '../surfaces.svelte'
import { workspace } from '../workspace.svelte'

$effect.root(() => {
  $effect(() => {
    const watched = `${workspace.activeTabId}:${workspace.activeSpaceId}:${workspace.tabs.length}`
    if (tabOverview.open || !watched) return

    const timer = setTimeout(() => workspace.closeLeftBlank(), 0)
    return () => clearTimeout(timer)
  })
})
