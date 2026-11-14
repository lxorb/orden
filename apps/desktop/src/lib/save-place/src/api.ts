import { workspace } from '../../workspace.svelte'
import { isUnsaved } from '../../workspace/drafts'

export function askPlace(tabId?: string | null, saved?: () => void): void {
  void import('./ask').then((one) =>
    saved ? one.askPlace(tabId ?? null, saved) : one.askPlace(tabId ?? null),
  )
}

export function saveFront(): void {
  const tab = workspace.active
  if (tab && isUnsaved(tab.note)) askPlace(tab.id)
  else void workspace.writeNow()
}
