/** Unloading a tab from its menu (#1127), as Firefox and Edge do: a switch under Tabs in
 *  General, off out of the box, and with it on a tab's menu offers Unload tab, Unload
 *  other tabs and Unload tabs to the right.
 *
 *  An unloaded tab stays where it is in the strip with its name and its mark, the mark
 *  dimmed, and lets go of what drew it: a website's page is parked the way Memory saver
 *  parks one - the webview goes, and the address, the place and the trail stay, so
 *  choosing the tab again loads the page where it was (`park` in web-tab/pages.svelte.ts)
 *  - and a note's editor state is let go of by its pane, built again from the note the
 *  next time it is shown (`held` in Pane.svelte). Every other kind this offers draws only
 *  while it is in front, and lets go of nothing more. Showing the tab is what loads it
 *  again, so the mark comes back with it; the overview goes on drawing it from its last
 *  picture, which unloading leaves where it is (lib/overview).
 *
 *  What is owed to the disk is written first. Never offered for a tab that cannot come
 *  back as it was: a terminal, whose shell would end, an online terminal's session, an
 *  application on another device, the AI panel, a private page, whose session is the
 *  page, and a tab an agent is acting in. A page with something typed into it and not
 *  sent, or still on its way - a form being sent among them - asks first. A tab on
 *  screen hands its place to the tab used before it, or leaves the pane showing nothing
 *  where there is none. Kept on this device through stored.ts. */

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

/** The kinds that come back as they were from what their tab keeps. */
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

/** Which tabs a row unloads: the tab, the others in its strip, or those after it. */
export type Unloading = 'tab' | 'others' | 'right'

/** Whether the tab is on screen as a column of a stacked pane, which draws every note
 *  in it at once; see `columns` in Pane.svelte. */
function inColumns(tab: Tab): boolean {
  const pane = workspace.panes.at(tab.paneId)
  return !!pane?.stacked && !viewport.touch && tab.kind === 'note' && !tab.reading
}

/** Whether a tab may be unloaded now: loaded, of a kind that comes back as it was, and
 *  nothing in it somebody else is using. */
export function mayUnload(tab: Tab): boolean {
  if (tab.unloaded || !UNLOADS.has(tab.kind) || inColumns(tab)) return false
  if (tab.inPrivate || tab.id in agentMarks.on) return false
  return !(tab.kind === 'web' && pages.lentOf(tab.id))
}

/** The tabs a row would unload, in strip order. */
export function unloadsAround(tab: Tab, which: Unloading): Tab[] {
  const around = which === 'tab' ? [tab] : closedAround(workspace.tabsIn(tab.paneId), tab.id, which)
  return around.filter(mayUnload)
}

/** Whether a page among `tabs` would lose something, asked once for all of them. */
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

/** Moves the pane off the tab it is showing, if that is among `going`: to the tab the
 *  row was asked on where it stays, else to the tab used before it, else to nothing. */
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

/** Unloads what a row names, around `tab`. */
export async function unload(tab: Tab, which: Unloading): Promise<void> {
  const going = unloadsAround(tab, which)
  if (!going.length || !(await mayLose(going))) return

  stepAside(tab, which, going)
  // The pane has let go of the tab before anything behind it goes.
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

/** Left and right in a label are the screen's, as Close tabs to the right's are. */
function afterLabel(): string {
  return i18n.factor > 0 ? t('Unload tabs to the right') : t('Unload tabs to the left')
}

/** The rows a tab's menu offers with the setting on; nothing with it off, or for a tab
 *  that cannot be unloaded. The two about the strip are greyed where nothing around the
 *  tab can be. */
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
