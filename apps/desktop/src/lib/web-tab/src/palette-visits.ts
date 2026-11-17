import type { PaletteVisits } from '@orden/contracts'
import { pages } from './pages.svelte'
import { upgradeOf } from './upgrade'
import { visited } from './visited'
import { webData } from './web-data.svelte'

export const visits: PaletteVisits = {
  list: () => visited.all(webData.history()),
  forget: (url) => visited.remove(webData.history(), url),
  opened: (tab, typed, url) => {
    pages.of(tab).upgrade = upgradeOf(typed, url)
  },
}
