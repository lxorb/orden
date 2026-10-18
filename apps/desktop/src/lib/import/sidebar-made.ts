/** What every browser without spaces of its own is read into on the way to a sidebar
 *  (sidebar.ts): one space, its folders and its tabs as the reader finds them, and only
 *  the folders that end up holding a page. firefox.ts and chromium.ts read into it. */

import { isWebAddress } from '../web-tab/address'
import type { Sidebar, SidebarFolder, SidebarTab } from './sidebar'

/** The names of the folders the import makes, in the reader's language. */
export interface FolderWords {
  bookmarks: string
  savedGroups: string
  /** A tab group with no name of its own. */
  group: string
  /** Firefox's bookmarks toolbar, and Chromium's bar. */
  toolbar: string
  bar: string
  menu: string
  other: string
  mobile: string
}

/** What a browser's JSON said, read field by field. */
export type Said = Record<string, unknown>

export function isObject(value: unknown): value is Said {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function list(value: unknown): Said[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** What a page with no title of its own is called: where it is, without the scheme,
 *  which a session written before the page drew its title often says. */
function untitled(url: string): string {
  try {
    const { host, pathname, search } = new URL(url)
    return `${host.replace(/^www\./, '')}${pathname.replace(/\/$/, '')}${search}`
  } catch {
    return url
  }
}

/** The one space a profile is. */
const SPACE = 'browser'

/** The folders and tabs as they are read, and which folders end up holding a page. */
export class Made {
  readonly folders: SidebarFolder[] = []
  readonly tabs: SidebarTab[] = []

  folder(id: string, name: string, parent: string | null) {
    if (this.folders.some((one) => one.id === id)) return
    this.folders.push({ id, name, icon: null, parent, space: SPACE, split: false })
  }

  tab(tab: Omit<SidebarTab, 'home' | 'space' | 'essential'> & { essential?: boolean }) {
    if (!isWebAddress(tab.url)) return
    const title = tab.title.trim() && tab.title !== tab.url ? tab.title : untitled(tab.url)
    this.tabs.push({
      ...tab,
      title,
      home: null,
      space: SPACE,
      essential: tab.essential ?? false,
    })
  }

  /** The folders some page is in, at whatever depth. */
  kept(): SidebarFolder[] {
    const byId = new Map(this.folders.map((one) => [one.id, one]))
    const full = new Set<string>()
    for (const tab of this.tabs) {
      for (let at = tab.folder ? byId.get(tab.folder) : undefined; at && !full.has(at.id);) {
        full.add(at.id)
        at = at.parent ? byId.get(at.parent) : undefined
      }
    }
    return this.folders.filter((one) => full.has(one.id))
  }

  /** All of it as the one space named `name`. */
  sidebar(name: string): Sidebar {
    return {
      spaces: [{ id: SPACE, name, icon: null, colour: null, container: 0 }],
      folders: this.kept(),
      tabs: this.tabs,
    }
  }
}
