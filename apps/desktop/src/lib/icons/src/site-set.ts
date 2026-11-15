import { portOf, type SiteIconsHeld } from '@orden/contracts'
import type { LoadedSet } from './icon-sets'

function siteSetOf(held: SiteIconsHeld): LoadedSet {
  void held.refresh()
  return {
    groups: [],
    get unoffered() {
      return held.lacking
    },
    get entries() {
      return held.list
        .filter((one) => one.picture !== null)
        .map((one) => ({
          name: one.site,
          words: (one.label || one.site).toLowerCase(),
          terms: `${one.site} ${one.site.replace(/\./g, ' ')}`,
        }))
    },
    shape(name) {
      const src = held.picture(name)
      return src ? { kind: 'picture', src } : null
    },
  }
}

export async function loadSites(): Promise<LoadedSet> {
  const sites = portOf('web.siteIcons')
  if (!sites.ok) throw new Error(sites.error.message)
  return siteSetOf(await sites.value.held())
}

export function refreshSites(): void {
  const sites = portOf('web.siteIcons')
  if (sites.ok) void sites.value.held().then((held) => held.refresh())
}
