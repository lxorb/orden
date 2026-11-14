export interface SidebarSpace {
  id: string
  name: string
  icon: string | null
  colour: [number, number, number] | null
  container: number
}

export interface SidebarFolder {
  id: string
  name: string
  icon: string | null
  parent: string | null
  space: string | null
  split: boolean
}

export interface SidebarTab {
  title: string
  url: string
  home: string | null
  icon: string | null
  pinned: boolean
  essential: boolean
  space: string | null
  folder: string | null
  container: number
  added?: Date
}

export interface Sidebar {
  spaces: SidebarSpace[]
  folders: SidebarFolder[]
  tabs: SidebarTab[]
  dropped?: number
}
