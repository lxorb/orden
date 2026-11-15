import { DIVIDER, menu, trim, type MenuEntry } from '../../menu.svelte'
import { noteMenu } from '../../note-menu'
import { tabMenus } from '../../tab-strip/src/api'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace.svelte'
import { TAB_KINDS, type TabPanel } from '../../tab-kinds/src/api'

const PANEL_WORDS: Record<TabPanel, () => string> = {
  outline: () => 'Outline',
  links: () => 'Links',
}

export async function showNoteMore(from: HTMLElement) {
  const box = from.getBoundingClientRect()
  const at = new MouseEvent('contextmenu', { clientX: box.right, clientY: box.bottom })
  const { tabMenu } = await tabMenus(workspace.active?.kind)
  const title = workspace.active?.shown
  menu.show(at, noteMore(tabMenu), title ? { title } : {})
}

function noteMore(tabMenu: (tab: Tab, paneId: string) => MenuEntry[]): MenuEntry[] {
  const tab = workspace.active
  if (!tab) return []

  const paneId = workspace.panes.focusedId
  const panels: MenuEntry[] = TAB_KINDS[tab.kind].panels
    .filter((panel) => workspace.offers(panel))
    .map((panel) => ({ label: PANEL_WORDS[panel](), run: () => workspace.showPanel(panel) }))
  const writes = TAB_KINDS[tab.kind].editor ? noteMenu(paneId) : []

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
