import { isWebAddress } from '@orden/scan/web-address'
import type { Sidebar, SidebarFolder, SidebarTab } from './sidebar'

export interface FolderWords {
  bookmarks: string
  savedGroups: string
  group: string
  toolbar: string
  bar: string
  menu: string
  other: string
  mobile: string
  favorites: string
  readingList: string
}

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

export function siteMark(value: unknown): string | null {
  const said = text(value)
  if (!said?.startsWith('moz-remote-image:')) return said
  const query = said.slice(said.indexOf('?') + 1)
  return said.includes('?') ? text(new URLSearchParams(query).get('url')) : null
}

function untitled(url: string): string {
  try {
    const { host, pathname, search } = new URL(url)
    return `${host.replace(/^www\./, '')}${pathname.replace(/\/$/, '')}${search}`
  } catch {
    return url
  }
}

const SPACE = 'browser'

export interface Step {
  key: string
  name: string
}

export class Made {
  readonly folders: SidebarFolder[] = []
  readonly tabs: SidebarTab[] = []
  dropped = 0

  constructor(readonly space = SPACE) {}

  folder(id: string, name: string, parent: string | null, space = this.space) {
    if (this.folders.some((one) => one.id === id)) return
    this.folders.push({ id, name, icon: null, parent, space, split: false })
  }

  within(steps: readonly Step[], space = this.space): string | null {
    let parent: string | null = null
    for (const step of steps) {
      const id = space === this.space ? step.key : `${step.key}@${space}`
      this.folder(id, step.name, parent, space)
      parent = id
    }
    return parent
  }

  tab(
    tab: Omit<SidebarTab, 'home' | 'space' | 'essential'> & { essential?: boolean; space?: string },
  ) {
    if (!isWebAddress(tab.url)) {
      this.dropped++
      return
    }
    const title = tab.title.trim() && tab.title !== tab.url ? tab.title : untitled(tab.url)
    this.tabs.push({
      ...tab,
      title,
      home: null,
      space: tab.space ?? this.space,
      essential: tab.essential ?? false,
    })
  }

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

  sidebar(name: string): Sidebar {
    return {
      spaces: [{ id: this.space, name, icon: null, colour: null, container: 0 }],
      folders: this.kept(),
      tabs: this.tabs,
      dropped: this.dropped,
    }
  }
}
