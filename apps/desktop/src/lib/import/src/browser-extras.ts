import { webPages } from '@orden/contracts'
import { invoke } from '../../platform/src/api'
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

  await webPages().bringHistory(rows)
}

export async function takeEngine(engine: BrowserEngine | null, browser: string): Promise<string[]> {
  if (!engine) return []
  const taken = await webPages().takeEngine(
    'id' in engine ? { id: engine.id } : { custom: engine.custom },
  )
  if (taken !== 'kept') return []
  return [`${browser} searches with ${engine.name}: choose it in Settings to search with it here`]
}

export function droppedLine(sidebar: Sidebar): string[] {
  const count = sidebar.dropped ?? 0
  if (!count) return []
  return [
    count === 1
      ? '1 page not on the web stays behind'
      : `${count} pages not on the web stay behind`,
  ]
}

export function folderWords(): FolderWords {
  return {
    bookmarks: 'Bookmarks',
    savedGroups: 'Saved groups',
    group: 'Tab group',
    toolbar: 'Bookmarks toolbar',
    bar: 'Bookmarks bar',
    menu: 'Bookmarks menu',
    other: 'Other bookmarks',
    mobile: 'Mobile bookmarks',
    favorites: 'Favorites',
    readingList: 'Reading List',
  }
}
