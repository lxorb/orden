import type { Tab } from '../workspace.svelte'
import { workspace } from '../workspace.svelte'
import { HISTORY, isOwnPage } from './own-pages'
import { pages } from './pages.svelte'

export function openHistory(from: Tab | null = workspace.active): void {
  const open = workspace.tabs.find(
    (one) => one.kind === 'web' && isOwnPage(pages.addressOf(one.id) ?? one.address),
  )
  if (open) {
    workspace.activate(open.id)
    return
  }

  const blank =
    from?.kind === 'web' && from.path === null && !from.address && !pages.addressOf(from.id)
  if (from && blank) {
    pages.of(from.id).url = HISTORY
    workspace.webWalked(from, HISTORY)
    return
  }

  workspace.openPage(HISTORY, 'front', from?.id)
}
