import { DIVIDER, menu, trim, type MenuEntry } from '../menu.svelte'
import { noteMenu } from '../note-menu'
import { tabMenu } from '../tab-strip/menu'
import { workspace } from '../workspace.svelte'
import { TAB_KINDS, type TabPanel } from '../workspace/tab-kinds'

const PANEL_WORDS: Record<TabPanel, () => string> = {
  outline: () => 'Outline',
  links: () => 'Links',
}

export function showNoteMore(from: HTMLElement) {
  const box = from.getBoundingClientRect()
  const at = new MouseEvent('contextmenu', { clientX: box.right, clientY: box.bottom })
  const title = workspace.active?.shown
  menu.show(at, noteMore(), title ? { title } : {})
}

function noteMore(): MenuEntry[] {
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
