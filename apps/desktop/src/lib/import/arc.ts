/** What Arc's sidebar says, read into a browser's sidebar (sidebar.ts): its spaces, each
 *  with its pinned tabs and folders and its open tabs, and its Favorites.
 *
 *  Arc keeps all of it in `StorableSidebar.json`, beside its user data folder, one file
 *  for every profile (chromium_profiles.rs): `sidebar.containers`, of which the one
 *  after `{ global }` holds `spaces` and `items`, each a list of ids and objects one
 *  after the other.
 *
 *  - **A space** is `{ id, title, profile, customInfo, newContainerIDs }`: its profile
 *    is `{ default }` or `{ custom: { _0: { directoryBasename } } }`, the profile's
 *    folder, and only the spaces of the profile being imported come. Its icon is an
 *    emoji (`customInfo.iconType.emoji_v2`); `newContainerIDs` (`containerIDs` before)
 *    names its two lists of items, `pinned` and `unpinned`.
 *  - **An item** is `{ id, parentID, childrenIds, title, data }`: a tab
 *    (`data.tab.savedURL`, `savedTitle`), a folder (`data.list`), a split view
 *    (`data.splitView`, its tabs side by side), or a list of a space or of the
 *    Favorites (`data.itemContainer`). Its children come in `childrenIds`' order.
 *  - **The Favorites** are the items of the container `topAppsContainerIDs` names for
 *    the profile, which Arc shows above every space as Zen shows its Essentials, and
 *    which are Orden's Essentials too.
 *
 *  A pinned tab is a pinned tab, an open one a tab of the day, a folder a folder, as
 *  Zen's are (zen-plan.ts). An easel or a note of Arc's is not a page, and stays; a
 *  line says so. Pure: the file as it was parsed, the sidebar out. */

import type { Sidebar, SidebarFolder, SidebarSpace, SidebarTab } from './sidebar'
import { isObject, list, type Said, text } from './sidebar-made'

/** What came of the file: the sidebar, and how many easels and notes stayed. */
export interface ArcRead {
  sidebar: Sidebar
  stayed: number
}

/** The profile's spaces out of Arc's sidebar; `folder` is the profile's folder in the
 *  user data, `Default` for Arc's first. Null where the file holds none of them. */
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

/** What a list's tabs are. */
type Row = 'essential' | 'pinned' | 'open'

/** The id a list of markers and ids gives after the marker `wanted` picks: Arc writes
 *  `[marker, id, marker, id]`, a marker an object or, in an older file, a word. */
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

/** Whether a space's or the Favorites' profile is the one being read. */
function profileIs(profile: unknown, folder: string): boolean {
  if (!isObject(profile)) return folder === 'Default'
  if ('default' in profile) return folder === 'Default'
  const custom = isObject(profile.custom) ? profile.custom._0 : null
  return isObject(custom) && text(custom.directoryBasename) === folder
}

/** A space's emoji: `emoji_v2`, or before it the emoji's code point. */
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

/** Deeper than anybody nests, and a stop for a sidebar that goes round. */
const DEEPEST = 64

/** The rows under the item `id`, in their order: tabs, and folders of rows. */
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
