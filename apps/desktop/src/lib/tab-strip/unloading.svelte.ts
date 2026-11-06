import { tick } from 'svelte'
import { agentMarks } from '../agent-marks.svelte'
import { i18n, t } from '../i18n.svelte'
import type { MenuEntry } from '../menu-item'
import { keep, storedText } from '../stored'
import { pages } from '../web-tab/pages.svelte'
import { viewport } from '../viewport.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { closedAround } from '../workspace/closing-around'
import type { TabKind } from '../workspace/tab-kinds'

const KEY = 'nib:unload-tabs'

class UnloadTabs {
  on = $state(storedText(KEY) === 'yes')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}

export const unloadTabs = new UnloadTabs()

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
  return !(tab.kind === 'web' && pages.lentOf(tab.id))
}

export function unloadsAround(tab: Tab, which: Unloading): Tab[] {
  const around = which === 'tab' ? [tab] : closedAround(workspace.tabsIn(tab.paneId), tab.id, which)
  return around.filter(mayUnload)
}

async function mayLose(tabs: readonly Tab[]): Promise<boolean> {
  const webs = tabs.filter((one) => one.kind === 'web')
  const losing = await Promise.all(webs.map((one) => pages.losing(one.id)))
  if (!losing.some(Boolean)) return true

  const [only] = tabs
  const { prompt } = await import('../prompt.svelte')
  return prompt.confirm({
    title:
      tabs.length === 1 && only
        ? t('Unload {name}?', { name: only.shown })
        : t('Unload these tabs?'),
    detail: t('Anything typed into a page and not sent, or still being sent, is lost.'),
    confirmLabel: t('Unload'),
  })
}

function stepAside(tab: Tab, which: Unloading, going: readonly Tab[]) {
  const pane = workspace.panes.at(tab.paneId)
  const front = pane?.activeTabId ?? null
  if (!pane || front === null || !going.some((one) => one.id === front)) return

  if (which !== 'tab') {
    workspace.activate(tab.id)
    return
  }
  const strip = workspace.tabsIn(pane.id)
  const at = strip.findIndex((one) => one.id === tab.id)
  const left = strip.filter((one) => one.id !== tab.id && !one.unloaded).map((one) => one.id)
  const next = workspace.panes.successorOf(left, at < 0 ? undefined : at)
  if (next === null) workspace.deselect(pane.id)
  else workspace.activate(next)
}

export async function unload(tab: Tab, which: Unloading): Promise<void> {
  const going = unloadsAround(tab, which)
  if (!going.length || !(await mayLose(going))) return

  stepAside(tab, which, going)
  await tick()
  workspace.flush()
  await workspace.writesSettled()

  const parks: Promise<void>[] = []
  for (const one of going) {
    const front = workspace.panes.at(one.paneId)?.activeTabId === one.id
    if (!workspace.tabs.includes(one) || front || !mayUnload(one)) continue
    one.unloaded = true
    if (one.kind === 'web') parks.push(pages.park(one.id, true))
  }
  await Promise.all(parks)
}

function afterLabel(): string {
  return i18n.factor > 0 ? t('Unload tabs to the right') : t('Unload tabs to the left')
}

export function unloadEntries(tab: Tab): MenuEntry[] {
  if (!unloadTabs.on) return []

  const rows: MenuEntry[] = []
  if (mayUnload(tab)) rows.push({ label: t('Unload tab'), run: () => void unload(tab, 'tab') })
  if (tab.essential !== null) return rows

  rows.push(
    {
      label: t('Unload other tabs'),
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
