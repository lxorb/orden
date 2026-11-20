import { type TabKind, webPages } from '@orden/contracts'
import { tick } from 'svelte'
import { agentMarks } from '../../workspace/src/api'
import { DIVIDER, type MenuEntry, viewport } from '../../ui-kit/src/api'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { closedAround } from '../../panes/src/api'
import { unloadTabs } from './unload-choice.svelte'
import { chosen } from './picking.svelte'

const UNLOADS: ReadonlySet<TabKind> = new Set<TabKind>([
  'note',
  'graph',
  'pdf',
  'canvas',
  'pages',
  'web',
  'view',
  'channel',
])
export type Unloading = 'tab' | 'others' | 'right'
function inColumns(tab: Tab): boolean {
  const pane = workspace.panes.at(tab.paneId)
  return !!pane?.stacked && !viewport.touch && tab.kind === 'note' && !tab.reading
}
export function mayUnload(tab: Tab): boolean {
  if (tab.unloaded || !UNLOADS.has(tab.kind) || inColumns(tab)) return false
  if (tab.inPrivate || tab.id in agentMarks.on) return false
  return !(tab.kind === 'web' && webPages().lentOf(tab.id))
}
export function unloadsAround(tab: Tab, which: Unloading): Tab[] {
  const around = which === 'tab' ? [tab] : closedAround(workspace.tabsIn(tab.paneId), tab.id, which)
  return around.filter(mayUnload)
}
async function mayLose(tabs: readonly Tab[]): Promise<boolean> {
  const webs = tabs.filter((one) => one.kind === 'web')
  const losing = await Promise.all(webs.map((one) => webPages().losing(one.id)))
  if (!losing.some(Boolean)) return true
  const [only] = tabs
  const { prompt } = await import('../../ui-kit/src/api')
  return prompt.confirm({
    title: tabs.length === 1 && only ? `Unload ${only.shown}?` : 'Unload these tabs?',
    detail: 'Anything typed into a page and not sent, or still being sent, is lost.',
    confirmLabel: 'Unload',
  })
}
function stepAside(going: readonly Tab[], stay: Tab | null) {
  const [first] = going
  const pane = first ? workspace.panes.at(first.paneId) : undefined
  const front = pane?.activeTabId ?? null
  if (!pane || front === null || !going.some((one) => one.id === front)) return
  if (stay) {
    workspace.activate(stay.id)
    return
  }
  const strip = workspace.tabsIn(pane.id)
  const left = strip.filter((one) => !going.includes(one)).map((one) => one.id)
  const at = strip
    .slice(
      0,
      strip.findIndex((one) => one.id === front),
    )
    .filter((one) => !going.includes(one)).length
  const next = workspace.panes.successorOf(left, at)
  if (next === null) workspace.deselect(pane.id)
  else workspace.activate(next)
}
async function unloadAll(going: readonly Tab[], stay: Tab | null): Promise<void> {
  if (!going.length || !(await mayLose(going))) return
  stepAside(going, stay)
  await tick()
  workspace.flush()
  await workspace.writesSettled()
  const parks: Promise<void>[] = []
  for (const one of going) {
    const front = workspace.panes.at(one.paneId)?.activeTabId === one.id
    if (!workspace.tabs.includes(one) || front || !mayUnload(one)) continue
    one.unloaded = true
    if (one.kind === 'web') parks.push(webPages().park(one.id, true))
  }
  chosen.drop(going.filter((one) => one.unloaded).map((one) => one.id))
  await Promise.all(parks)
}
export function unload(tab: Tab, which: Unloading): Promise<void> {
  return unloadAll(unloadsAround(tab, which), which === 'tab' ? null : tab)
}
export function unloadPicked(tabs: readonly Tab[]): Promise<void> {
  return unloadAll(tabs.filter(mayUnload), null)
}
export function pickedUnloadEntries(tabs: readonly Tab[]): MenuEntry[] {
  if (!unloadTabs.on || !tabs.some(mayUnload)) return []
  return [{ label: 'Unload tabs', run: () => void unloadPicked(tabs) }, DIVIDER]
}
function afterLabel(): string {
  return 'Unload tabs to the right'
}
export function unloadEntries(tab: Tab): MenuEntry[] {
  if (!unloadTabs.on) return []
  const rows: MenuEntry[] = []
  if (mayUnload(tab)) rows.push({ label: 'Unload tab', run: () => void unload(tab, 'tab') })
  if (tab.essential !== null) return rows
  rows.push(
    {
      label: 'Unload other tabs',
      disabled: unloadsAround(tab, 'others').length === 0,
      run: () => void unload(tab, 'others'),
    },
    {
      label: afterLabel(),
      disabled: unloadsAround(tab, 'right').length === 0,
      run: () => void unload(tab, 'right'),
    },
  )
  return rows
}
