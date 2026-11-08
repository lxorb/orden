import type { OpenHow } from '../new-tab'
import { appsOn } from '../settings.svelte'
import { nameOf, samePath } from '../space-paths'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'

export function appName(path: string): string {
  return nameOf(path).replace(/\.application$/i, '') || nameOf(path)
}

export function openApplication(path: string, how: OpenHow = {}): Tab | null {
  if (__EVEN_PLUGIN__ || !appsOn()) return null
  const open = workspace.tabs.find((one) => one.kind === 'application' && samePath(one.path, path))
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    return open
  }
  const beside = how.beside ? workspace.activeTabId : null
  const tab = workspace.openUnsaved('application', '', appName(path), beside, how.activate ?? true)
  tab.path = path
  workspace.persist()
  return tab
}
