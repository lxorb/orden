import { DIVIDER, menu, trim, type MenuEntry } from '../../ui-kit/src/api'
import { noteMenus, tabMenus } from '../../tab-strip/src/api'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { TAB_KINDS, type TabPanel } from '../../tab-kinds/src/api'

const PANEL_WORDS: Record<TabPanel, () => string> = {
  outline: () => 'Outline',
  links: () => 'Links',
}

export async function showNoteMore(from: HTMLElement) {
  const box = from.getBoundingClientRect()
  const at = new MouseEvent('contextmenu', { clientX: box.right, clientY: box.bottom })
  const [{ tabMenu }, { noteMenu }] = await Promise.all([
    tabMenus(workspace.active?.kind),
    noteMenus(),
  ])
  const tab = workspace.active
  const writes = tab && TAB_KINDS[tab.kind].editor ? await noteMenu(workspace.panes.focusedId) : []
  const title = workspace.active?.shown
  menu.show(at, noteMore(tabMenu, writes), title ? { title } : {})
}

function noteMore(
  tabMenu: (tab: Tab, paneId: string) => MenuEntry[],
  writes: MenuEntry[],
): MenuEntry[] {
  const tab = workspace.active
  if (!tab) return []

  const paneId = workspace.panes.focusedId
  const panels: MenuEntry[] = TAB_KINDS[tab.kind].panels
    .filter((panel) => workspace.offers(panel))
    .map((panel) => ({ label: PANEL_WORDS[panel](), run: () => workspace.showPanel(panel) }))

  const said = new Set<string>()
  const once = (entries: MenuEntry[]) =>
    entries.filter((one) => {
      if (one === DIVIDER) return true
      if (said.has(one.label)) return false
      said.add(one.label)
      return true
    })

  return trim([...once(panels), DIVIDER, ...once(writes), DIVIDER, ...once(tabMenu(tab, paneId))])
}
