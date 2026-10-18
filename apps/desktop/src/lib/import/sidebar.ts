/** A browser's sidebar as every reader of one hands it over: its spaces, its folders
 *  and its tabs, in the order the browser draws them. Zen's session, Firefox's and
 *  Chromium's are read into this one shape (zen.ts, firefox.ts, chromium.ts), and
 *  sidebar-plan.ts makes nib's spaces of it, so a browser is a reader and nothing
 *  else. A browser without spaces is one space; one without folders has its tab
 *  groups and its bookmark folders as folders instead.
 *
 *  Types only. */

export interface SidebarSpace {
  id: string
  name: string
  /** An emoji, a `chrome://` address of one of Zen's drawings, or null. */
  icon: string | null
  /** The theme's main colour, where it has one. */
  colour: [number, number, number] | null
  /** The container new tabs in the space open in, or nought for none. */
  container: number
}

export interface SidebarFolder {
  id: string
  name: string
  icon: string | null
  parent: string | null
  space: string | null
  /** A split view, which is a group of tabs side by side rather than a folder. */
  split: boolean
}

export interface SidebarTab {
  title: string
  /** Where the tab is now. */
  url: string
  /** Where a pinned tab goes back to, when that is somewhere else. */
  home: string | null
  /** The site's mark as the session kept it: an address or a `data:` picture. */
  icon: string | null
  pinned: boolean
  essential: boolean
  space: string | null
  folder: string | null
  /** The container the tab is open in, or nought for none. */
  container: number
  /** When it was kept, where the browser says: a bookmark's day, not the import's. */
  added?: Date
}

export interface Sidebar {
  /** In the order the browser's space switcher shows them. */
  spaces: SidebarSpace[]
  /** In the order they sit in the sidebar. */
  folders: SidebarFolder[]
  /** In the order they sit in the sidebar, each once. */
  tabs: SidebarTab[]
}
