import type { Sidebar, SidebarFolder, SidebarSpace, SidebarTab } from './sidebar'
import { isObject, list, type Said, text } from './sidebar-made'

export interface ArcRead {
  sidebar: Sidebar
  stayed: number
}

export function arcSidebar(said: unknown, folder: string): ArcRead | null {
  const sidebar = isObject(said) && isObject(said.sidebar) ? said.sidebar : null
  const containers = list(sidebar?.containers)
  const at = containers.findIndex((one) => 'global' in one)
  const held = containers[at + 1] ?? containers.find((one) => Array.isArray(one.spaces))
  if (!held) return null

  const items = new Map<string, Said>()
  for (const one of list(held.items)) {
    const id = text(one.id)
    if (id) items.set(id, one)
  }

  const read: Reading = { items, folders: [], tabs: [], stayed: 0 }
  const favourites = listOf(held.topAppsContainerIDs, (marker) => profileIs(marker, folder))
  if (favourites) rows(read, favourites, null, null, 'essential')

  const spaces: SidebarSpace[] = []
  for (const space of list(held.spaces)) {
    const id = text(space.id)
    if (!id || !profileIs(space.profile, folder)) continue
    spaces.push({
      id,
      name: text(space.title) ?? 'Arc',
      icon: iconOf(space.customInfo),
      colour: null,
      container: 0,
    })

    const containers = space.newContainerIDs ?? space.containerIDs
    const pinned = listOf(containers, (marker) => isKey(marker, 'pinned'))
    const open = listOf(containers, (marker) => isKey(marker, 'unpinned'))
    if (pinned) rows(read, pinned, id, null, 'pinned')
    if (open) rows(read, open, id, null, 'open')
  }
  if (!spaces.length) return null

  return { sidebar: { spaces, folders: read.folders, tabs: read.tabs }, stayed: read.stayed }
}

interface Reading {
  items: Map<string, Said>
  folders: SidebarFolder[]
  tabs: SidebarTab[]
  stayed: number
}

type Row = 'essential' | 'pinned' | 'open'

function listOf(value: unknown, wanted: (marker: unknown) => boolean): string | null {
  if (!Array.isArray(value)) return null
  for (let at = 0; at + 1 < value.length; at += 2) {
    if (wanted(value[at])) return text(value[at + 1])
  }
  return null
}

function isKey(marker: unknown, key: string): boolean {
  return marker === key || (isObject(marker) && key in marker)
}

function profileIs(profile: unknown, folder: string): boolean {
  if (!isObject(profile)) return folder === 'Default'
  if ('default' in profile) return folder === 'Default'
  const custom = isObject(profile.custom) ? profile.custom._0 : null
  return isObject(custom) && text(custom.directoryBasename) === folder
}

function iconOf(info: unknown): string | null {
  const kind = isObject(info) && isObject(info.iconType) ? info.iconType : null
  if (!kind) return null
  const emoji = text(kind.emoji_v2)
  if (emoji) return emoji
  const point = Number(kind.emoji)
  return Number.isInteger(point) && point > 0 && point <= 0x10ffff
    ? String.fromCodePoint(point)
    : null
}

const DEEPEST = 64

function rows(
  read: Reading,
  id: string,
  space: string | null,
  folder: string | null,
  row: Row,
  depth = 0,
) {
  const parent = read.items.get(id)
  if (!parent || depth > DEEPEST) return

  const children = Array.isArray(parent.childrenIds)
    ? parent.childrenIds.map(text).filter((one): one is string => one !== null)
    : [...read.items.entries()].filter(([, one]) => text(one.parentID) === id).map(([key]) => key)

  for (const child of children) {
    const item = read.items.get(child)
    const data = isObject(item?.data) ? item.data : null
    if (!item || !data) continue

    if (isObject(data.tab)) {
      const url = text(data.tab.savedURL)
      if (!url) continue
      read.tabs.push({
        title: text(item.title) ?? text(data.tab.savedTitle) ?? url,
        url,
        home: null,
        icon: null,
        pinned: row !== 'open',
        essential: row === 'essential',
        space,
        folder,
        container: 0,
      })
    } else if ('list' in data && space !== null) {
      read.folders.push({
        id: child,
        name: text(item.title) ?? 'Folder',
        icon: null,
        parent: folder,
        space,
        split: false,
      })
      rows(read, child, space, child, row, depth + 1)
    } else if ('splitView' in data) {
      rows(read, child, space, folder, row, depth + 1)
    } else if ('easel' in data || 'arcDocument' in data) {
      read.stayed++
    }
  }
}
