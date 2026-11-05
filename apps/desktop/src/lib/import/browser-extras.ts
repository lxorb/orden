/** What a browser's profile brings besides its sidebar, every browser's alike: the marks
 *  of the sites its tabs are on, out of its own store of them, since a session seldom
 *  keeps a mark as a picture; its history, into the one every page shares here
 *  (web-tab/visited.ts); and its search engine, where somebody chose one there and has
 *  chosen none here (search-engines.ts). The databases are the crate's to read
 *  (browser_data.rs); a profile without one brings the rest. And the lines that say
 *  what a profile holds that stays behind, and the names of the folders an import
 *  makes, which every browser's says alike. */

import { key, t } from '../i18n.svelte'
import { invoke } from '../tauri'
import type { Lost } from './plan'
import type { BrowserEngine } from './search-engines'
import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, text } from './sidebar-made'

/** The browser a profile is, as the crate names it. */
type Browser = string

/** Whether a tab already wears a picture of its mark. */
function marked(icon: string | null): boolean {
  return icon?.startsWith('data:image/') ?? false
}

/** The sidebar with every tab's mark the profile keeps a picture of. */
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

/** The profile's history folded into the one every page shares. Quiet where there is
 *  none to read. */
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

/** The browser's engine taken where nobody chose one here; where somebody did, a line
 *  says which the browser's was, for Settings. */
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

/** The line that counts the pages left behind for not being on the web, where any were. */
export function droppedLine(sidebar: Sidebar): Lost[] {
  const count = sidebar.dropped ?? 0
  if (!count) return []
  return [
    {
      text: key('{count} pages not on the web stay behind'),
      // Filed under its `other` form; see notion.ts and i18n.svelte.ts.
      one: '{count} page not on the web stays behind',
      values: { count },
    },
  ]
}

/** The names of the folders the import makes, in the reader's language. */
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
