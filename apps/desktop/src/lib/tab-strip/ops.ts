import { folderNote } from '../folder-notes'
import { canWriteAt } from '../sharing/src/api'
import { folderOf, samePath } from '../platform/src/api'
import { pages } from '../web-tab/src/api'
import { workspace } from '../workspace.svelte'
import type { Tab } from '../workspace/documents.svelte'
import { nextPane } from '../workspace/pane-tree'

export function duplicateTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab || !workspace.canDuplicateTab(tab)) return

  const copy = workspace.copyOf(tab, tab.paneId)
  copy.cursor = tab.cursor
  copy.scroll = tab.scroll
  copy.anchor = tab.anchor
  copy.line = tab.line
  copy.folds = tab.folds
  copy.trail = tab.trail
  copy.at = tab.at
  copy.reading = tab.reading
  copy.source = tab.source
  copy.camera = tab.camera
  copy.page = tab.page
  copy.zoom = tab.zoom
  copy.address = pages.addressOf(tab.id) ?? tab.address
  copy.inPrivate = tab.inPrivate
  copy.apart = tab.apart

  if (tab.kind === 'web') {
    const page = pages.of(copy.id)
    page.url = copy.address ?? null
    page.title = pages.of(tab.id).title
    page.inPrivate = tab.inPrivate
  }

  const at = workspace.tabsIn(tab.paneId).indexOf(tab)
  workspace.tabs = [...workspace.tabs, copy]
  workspace.moveTab(copy.id, tab.paneId, at + 1)
}

export function moveToOtherPane(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab || !workspace.canMoveToOtherPane(id)) return

  const next = workspace.panes.count > 1 ? nextPane(workspace.panes.frame, tab.paneId) : null
  if (next) workspace.moveTab(id, next.id)
  else workspace.dropTab(id, { kind: 'pane', paneId: tab.paneId, zone: 'right' })
}

export function renamesFromTab(tab: Tab): boolean {
  return workspace.canRenameFromTab(tab) && (tab.path === null || canWriteAt(tab.path))
}

export function renameFromTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab || !renamesFromTab(tab)) return
  if (tab.kind === 'terminal') {
    nameInStrip(tab)
    return
  }
  const path = tab.path
  if (!path) return

  const folder = workspace.entryAt(folderOf(path))
  const row = folder && folderNote(folder)?.path === path ? folder.path : path

  workspace.activeTabId = tab.id
  workspace.showPanel('tree')
  if (!samePath(folderOf(row), workspace.activeSpace?.root)) workspace.revealFolder(folderOf(row))
  workspace.startRenaming(row)
}

function nameInStrip(tab: Tab) {
  for (const one of workspace.tabs) one.naming = one === tab
  workspace.activate(tab.id)
}
