import { normalizeUrl } from '@orden/pass/urls'
import { openExternal } from '../platform/src/api'
import { workspace } from '../workspace.svelte'

export function openSite(url: string): void {
  const address = normalizeUrl(url)
  if (address === null) return
  if (workspace.openPage(address) === null) void openExternal(address)
}
