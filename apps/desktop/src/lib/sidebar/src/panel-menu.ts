import { searching, type SearchSort, sidebarPart } from '@orden/contracts'
import { DIVIDER, type MenuEntry } from '../../ui-kit/src/api'
import { panels, type Panel, type PanelSide } from '../../session/src/api'
import { workspace } from '../../workspace/src/api'

const sortMenu = (making: MenuEntry[]): MenuEntry[] => [
  {
    label: workspace.treeOptions.showHidden ? 'Hide hidden files' : 'Show hidden files',
    run: () => workspace.toggleHidden(),
  },
  DIVIDER,
  ...making,
]
function resultsMenu(): MenuEntry[] {
  const search = searching()?.panel
  if (!search) return []
  const arrow = (key: SearchSort) =>
    search.ordering.sort === key ? (search.ordering.descending ? '↓' : '↑') : undefined
  return (['relevance', 'name', 'modified', 'created'] as const).map((key) => ({
    label: `Sort by ${key}`,
    hint: arrow(key),
    run: () => search.setSort(key),
  }))
}
export function panelMenu(id: Panel, side: PanelSide | undefined, making: MenuEntry[] = []): MenuEntry[] {
  const sorts = id === 'tree' ? sortMenu(making) : id === 'search' ? resultsMenu() : making
  const toTab = sidebarPart(id)?.toTab
  const asTab: MenuEntry[] = toTab ? [{ label: 'Open in new tab', run: () => void toTab() }] : []
  const own = [...asTab, ...(asTab.length && sorts.length ? [DIVIDER] : []), ...sorts]
  const there: PanelSide = side === 'right' ? 'left' : 'right'
  if (!panels.mayLiveOn(id, there)) return own
  return [
    ...own,
    ...(own.length ? [DIVIDER] : []),
    {
      label: there === 'right' ? 'Move to the right' : 'Move to the left',
      run: () => workspace.movePanel(id, there),
    },
  ]
}
