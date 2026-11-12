import { DIVIDER, type MenuEntry } from './menu-item'
import { hasTab, openAsTab } from './panel-tab'
import { search, type SearchSort } from './search.svelte'
import { mayLiveOn } from './workspace/panels'
import { type Panel, type PanelSide, workspace } from './workspace.svelte'

function sortMenu(making: MenuEntry[]): MenuEntry[] {
  return [
    {
      label: workspace.treeOptions.showHidden ? 'Hide hidden files' : 'Show hidden files',
      run: () => workspace.toggleHidden(),
    },
    DIVIDER,
    ...making,
  ]
}

function resultsMenu(): MenuEntry[] {
  const arrow = (key: SearchSort) =>
    search.ordering.sort === key ? (search.ordering.descending ? '↓' : '↑') : undefined

  return [
    {
      label: 'Sort by relevance',
      hint: arrow('relevance'),
      run: () => search.setSort('relevance'),
    },
    { label: 'Sort by name', hint: arrow('name'), run: () => search.setSort('name') },
    {
      label: 'Sort by modified',
      hint: arrow('modified'),
      run: () => search.setSort('modified'),
    },
    {
      label: 'Sort by created',
      hint: arrow('created'),
      run: () => search.setSort('created'),
    },
  ]
}

export function panelMenu(
  id: Panel,
  side: PanelSide | undefined,
  making: MenuEntry[] = [],
): MenuEntry[] {
  const sorts =
    id === 'tree' ? sortMenu(making) : id === 'search' ? resultsMenu() : id === 'time' ? making : []
  const asTab: MenuEntry[] = hasTab(id)
    ? [{ label: 'Open in new tab', run: () => openAsTab(id) }]
    : []
  const own = [...asTab, ...(asTab.length && sorts.length ? [DIVIDER] : []), ...sorts]
  const there: PanelSide = side === 'right' ? 'left' : 'right'

  if (!mayLiveOn(id, there)) return own
  return [
    ...own,
    ...(own.length ? [DIVIDER] : []),
    {
      label: there === 'right' ? 'Move to the right' : 'Move to the left',
      run: () => workspace.movePanel(id, there),
    },
  ]
}
