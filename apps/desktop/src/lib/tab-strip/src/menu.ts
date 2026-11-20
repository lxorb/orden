import { tabKindParts, webPages } from '@orden/contracts'
import { isChatTarget } from '@orden/markdown/links'
import { agentMarks } from '../../workspace/src/api'
import { DIVIDER, type MenuEntry, viewport } from '../../ui-kit/src/api'
import { archiveEntry, bookmarkAll, shareEntry, stackEntries, webDataEntry } from '../../row-menu/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { shownName, nameOf, withinSpace } from '../../platform/src/api'
import { toggleFill } from '../../tab-fill/src/api'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { protectEntries } from '../../sharing/src/api'
import { closeAfterLabel } from '../../panes/src/api'
import { isUnsaved } from '../../documents/src/api'
import { askPlace } from '../../save-place/src/api'
import { duplicateTab, moveToOtherPane, renameFromTab, renamesFromTab } from './ops'
import { spaceEntry } from './to-space'
import { pickedUnloadEntries, unloadEntries } from './unloading.svelte'
import { chosen, duplicateMany, moveManyToOtherPane } from './picking.svelte'

function movedToSpace(tabs: readonly Tab[]): MenuEntry[] {
  return viewport.touch ? spaceEntry(tabs) : []
}
function agentEntries(tab: Tab): MenuEntry[] {
  const worn = agentMarks.on[tab.id]
  const act = agentMarks.act
  if (!worn || !act) return []
  return [
    worn.stopped
      ? { label: 'Resume', run: () => act(tab.id, 'resume') }
      : { label: 'Stop', run: () => act(tab.id, 'stop') },
    DIVIDER,
  ]
}
const keyed = (label: string, id: string, run: () => void, more = {}): MenuEntry => ({
  label,
  hint: shortcuts.hint(id),
  run,
  ...more,
})
const when = (yes: boolean, ...rows: MenuEntry[]): MenuEntry[] => (yes ? rows : [])
function keepEntry(tab: Tab): MenuEntry[] {
  return when(tab.id === workspace.previewTabId, {
    label: 'Keep open',
    run: () => workspace.keep(tab.id),
  })
}
function paneEntries(tab: Tab): MenuEntry[] {
  const entries = [
    ...when(
      workspace.canSplit('row', tab.id),
      keyed('Split right', 'pane.split-right', () => workspace.split('row', tab.id)),
    ),
    ...when(
      workspace.canSplit('column', tab.id),
      keyed('Split down', 'pane.split-down', () => workspace.split('column', tab.id)),
    ),
    ...when(
      workspace.canMoveToOtherPane(tab.id),
      keyed('Move to other pane', 'pane.move-tab', () => moveToOtherPane(tab.id)),
    ),
    ...when(
      !viewport.touch,
      keyed(
        workspace.panes.fills === null ? 'Full window' : 'Leave full window',
        'app.fill-tab',
        () => void toggleFill(tab.id),
      ),
    ),
  ]
  return entries.length ? [...entries, DIVIDER] : []
}
function readingEntry(tab: Tab): MenuEntry[] {
  return when(
    tab.kind === 'note',
    keyed(tab.reading ? 'Leave reading' : 'Reading', 'app.reading', () => workspace.toggleReading(tab.id)),
    DIVIDER,
  )
}
function kindEntries(tab: Tab): MenuEntry[] {
  const own = [
    ...(tabKindParts(tab.kind).menu?.(tab.id) ?? []),
    ...(tab.path === null ? [] : webDataEntry({ path: tab.path, is_dir: false })),
  ]
  return own.length ? [...own, DIVIDER] : []
}
const duplicable = (tab: Tab) => workspace.canDuplicateTab(tab) && tab.kind !== 'terminal'
function tabEntries(tab: Tab): MenuEntry[] {
  return [
    ...when(
      renamesFromTab(tab),
      keyed('Rename', 'tabs.rename', () => renameFromTab(tab.id)),
    ),
    ...when(
      duplicable(tab),
      keyed('Duplicate', 'app.duplicate-tab', () => duplicateTab(tab.id)),
    ),
    ...bookmarkAll(tab.path === null ? [] : [tab.path]),
  ]
}
function inListEntry(tab: Tab): MenuEntry[] {
  const root = workspace.activeSpace?.root
  const path = tab.path
  if (path === null || root === undefined || withinSpace(root, path) === null) return []
  const label = tab.kind === 'channel' || isChatTarget(path) ? 'Show in Chats' : 'Show in the file list'
  return [keyed(label, 'app.reveal', () => workspace.revealNote(path))]
}
function closeEntries(tab: Tab, close: () => void, others: number, after: () => void): MenuEntry[] {
  const around = (label: string, id: string, how: 'right' | 'all') =>
    keyed(label, id, () => void workspace.closeAround(tab.id, how), {
      disabled: workspace.closesAround(tab.id, how) === 0,
    })
  return [
    keyed('Close', 'app.close', close),
    { label: 'Close others', disabled: others === 0, run: after },
    around(closeAfterLabel(), 'app.close-right', 'right'),
    around('Close all', 'app.close-all', 'all'),
    ...when(
      workspace.closed.any,
      keyed('Reopen closed tab', 'app.reopen', () => void workspace.reopenClosed()),
    ),
  ]
}
function saveEntry(tab: Tab): MenuEntry[] {
  return when(isUnsaved(tab.note), { label: 'Save', hint: shortcuts.saveHint, run: () => askPlace(tab.id) }, DIVIDER)
}
function pickMenu(tabs: readonly Tab[], paneId: string): MenuEntry[] {
  const ids = tabs.map((one) => one.id)
  const web = tabs.filter((one) => one.kind === 'web')
  const last = tabs.at(-1)
  const others = workspace.tabsIn(paneId).filter((one) => !ids.includes(one.id))
  return [
    ...when(
      web.length > 0,
      {
        label: 'Reload',
        run: () => {
          for (const one of web) void webPages().reload(one.id)
        },
      },
      DIVIDER,
    ),
    ...when(
      tabs.every(duplicable),
      keyed('Duplicate', 'app.duplicate-tab', () => duplicateMany(ids)),
    ),
    ...bookmarkAll(tabs.flatMap((one) => (one.path === null ? [] : [one.path]))),
    ...movedToSpace(tabs),
    DIVIDER,
    ...pickedUnloadEntries(tabs),
    ...(last
      ? closeEntries(
          last,
          () => void workspace.closeMany(ids),
          others.length,
          () => void workspace.closeMany(others.map((one) => one.id)),
        )
      : []),
    ...when(
      workspace.canMoveToOtherPane(last?.id ?? ''),
      DIVIDER,
      keyed('Move to other pane', 'pane.move-tab', () => moveManyToOtherPane(ids)),
    ),
  ]
}
function pickOf(tab: Tab, paneId: string): Tab[] {
  const many = chosen.of(paneId)
  return many.some((one) => one.id === tab.id) ? many : []
}
export function tabMenuTitle(tab: Tab, paneId: string): string {
  const many = pickOf(tab, paneId).length
  return many ? (many === 1 ? '1 tab' : `${many} tabs`) : tab.shown
}
export function trailMenu(tab: Tab): MenuEntry[] {
  return tab.trail
    .slice(0, tab.at)
    .map((path, at) => ({ label: shownName(nameOf(path)), at }))
    .reverse()
    .map((row) => ({ label: row.label, run: () => void workspace.walk(row.at, tab.id) }))
}
export function tabMenu(tab: Tab, paneId: string): MenuEntry[] {
  const many = pickOf(tab, paneId)
  if (many.length) return pickMenu(many, paneId)
  return [
    ...agentEntries(tab),
    ...saveEntry(tab),
    ...readingEntry(tab),
    ...kindEntries(tab),
    ...tabEntries(tab),
    ...inListEntry(tab),
    ...movedToSpace([tab]),
    ...archiveEntry(tab.path),
    ...protectEntries(tab.path),
    DIVIDER,
    ...unloadEntries(tab),
    DIVIDER,
    ...closeEntries(
      tab,
      () => void workspace.closeAsking(tab.id),
      workspace.closesAround(tab.id, 'others'),
      () => void workspace.closeAround(tab.id, 'others'),
    ),
    DIVIDER,
    ...shareEntry(tab.path),
    ...stackEntries(paneId),
    ...paneEntries(tab),
    ...keepEntry(tab),
  ]
}
