import { key, t } from '../i18n.svelte'
import { invoke } from '../tauri'
import type { Lost } from './plan'
import type { BrowserEngine } from './search-engines'
import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, text } from './sidebar-made'

type Browser = string

function marked(icon: string | null): boolean {
  return icon?.startsWith('data:image/') ?? false
}

export async function withMarks(
  sidebar: Sidebar,
  browser: Browser,
  profile: string,
): Promise<Sidebar> {
  const pages = [...new Set(sidebar.tabs.filter((tab) => !marked(tab.icon)).map((tab) => tab.url))]
  if (!pages.length) return sidebar

  const marks = await invoke<string>('read_browser_icons', { browser, profile, pages })
    .then((said) => JSON.parse(said) as unknown)
    .catch(() => null)
  if (!isObject(marks)) return sidebar

  return {
    ...sidebar,
    tabs: sidebar.tabs.map((tab) => {
      const mark = text(marks[tab.url])
      return mark && !marked(tab.icon) ? { ...tab, icon: mark } : tab
    }),
  }
}

export async function bringHistory(browser: Browser, profile: string): Promise<void> {
  const rows = await invoke<string>('read_browser_history', { browser, profile })
    .then((said) => JSON.parse(said) as unknown)
    .catch(() => null)
  if (!Array.isArray(rows) || !rows.length) return

  const [{ visited }, { webData }] = await Promise.all([
    import('../web-tab/visited'),
    import('../web-tab/web-data.svelte'),
  ])
  visited.brought(webData.history(), rows)
}

export async function takeEngine(engine: BrowserEngine | null, browser: string): Promise<Lost[]> {
  if (!engine) return []
  const { CUSTOM, searchEngine } = await import('../web-tab/search-engine.svelte')
  const same =
    'id' in engine
      ? searchEngine.id === engine.id
      : searchEngine.id === CUSTOM && searchEngine.custom === engine.custom
  if (same) return []

  if (!searchEngine.chosen) {
    if ('id' in engine) searchEngine.choose(engine.id)
    else searchEngine.setCustom(engine.custom)
    return []
  }
  return [
    {
      text: key('{browser} searches with {engine}: choose it in Settings to search with it here'),
      values: { browser, engine: engine.name },
    },
  ]
}

export function droppedLine(sidebar: Sidebar): Lost[] {
  const count = sidebar.dropped ?? 0
  if (!count) return []
  return [
    {
      text: key('{count} pages not on the web stay behind'),
      one: '{count} page not on the web stays behind',
      values: { count },
    },
  ]
}

export function folderWords(): FolderWords {
  return {
    bookmarks: t('Bookmarks'),
    savedGroups: t('Saved groups'),
    group: t('Tab group'),
    toolbar: t('Bookmarks toolbar'),
    bar: t('Bookmarks bar'),
    menu: t('Bookmarks menu'),
    other: t('Other bookmarks'),
    mobile: t('Mobile bookmarks'),
    favorites: t('Favorites'),
    readingList: t('Reading List'),
  }
}
