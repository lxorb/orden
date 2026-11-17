import { readBookmarks } from './firefox'
import type { Sidebar, SidebarFolder, SidebarSpace, SidebarTab } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, siteMark, text } from './sidebar-made'

export type ZenSession = Sidebar

export interface ZenPlaces {
  spaces: unknown[]
  pins: unknown[]
  bookmarks: unknown
  assigned: unknown[]
}

export function readZenSession(said: unknown, places: ZenPlaces | null = null): ZenSession | null {
  if (!isObject(said)) return null

  const sidebar = Array.isArray(said.spaces) ? said : fromWindows(list(said.windows))
  const own = list(sidebar?.spaces)
  const spaces = inOrder(own.length ? own : list(places?.spaces).map(spaceRow))
    .map(spaceOf)
    .filter((one): one is SidebarSpace => one !== null)
  if (!spaces.length) return null

  const folders = list(sidebar?.folders)
  const tabs = list(sidebar?.tabs)
  if (own.length || !places) {
    return {
      spaces,
      folders: folders.map(folderOf).filter((one): one is SidebarFolder => one !== null),
      tabs: tabsOf(tabs),
    }
  }

  return pinnedIn(spaces, folders, tabs, list(places.pins))
}

export function withBookmarks(
  sidebar: ZenSession,
  places: ZenPlaces | null,
  words: FolderWords,
): ZenSession {
  const [first] = sidebar.spaces
  if (!first || !places || !isObject(places.bookmarks)) return sidebar

  const order = sidebar.spaces.map((one) => one.id)
  const shown = new Map<string, string>()
  for (const row of list(places.assigned)) {
    const guid = text(row.bookmark_guid)
    const space = text(row.workspace_uuid)
    if (!guid || !space || !order.includes(space)) continue
    const held = shown.get(guid)
    if (held === undefined || order.indexOf(space) < order.indexOf(held)) shown.set(guid, space)
  }

  const made = new Made(first.id)
  readBookmarks(places.bookmarks, made, words, (guid, around) =>
    guid === null ? around : (shown.get(guid) ?? around),
  )
  return {
    ...sidebar,
    folders: [...sidebar.folders, ...made.kept()],
    tabs: [...sidebar.tabs, ...made.tabs],
    dropped: (sidebar.dropped ?? 0) + made.dropped,
  }
}

function inOrder(spaces: Said[]): Said[] {
  return spaces
    .map((one, at) => ({ one, at, position: Number(one.position) }))
    .sort(
      (a, b) =>
        (Number.isFinite(a.position) ? a.position : a.at) -
          (Number.isFinite(b.position) ? b.position : b.at) || a.at - b.at,
    )
    .map(({ one }) => one)
}

function fromWindows(windows: Said[]): Said | null {
  const normal = windows.filter((one) => !one.isPrivate && !one.isPopup && !one.isTaskbarTab)
  const first = normal.find((one) => list(one.spaces).length) ?? normal[0]
  if (!first) return null

  return {
    spaces: first.spaces,
    folders: first.folders,
    tabs: normal.flatMap((one) => list(one.tabs)),
  }
}

function spaceRow(row: Said): Said {
  return {
    uuid: row.uuid,
    name: row.name,
    icon: row.icon,
    position: row.position,
    containerTabId: row.container_id,
    theme: { gradientColors: parsed(row.theme_colors) },
  }
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function spaceOf(one: Said): SidebarSpace | null {
  const id = text(one.uuid)
  if (!id) return null

  return {
    id,
    name: text(one.name) ?? 'Zen',
    icon: text(one.icon),
    colour: colourOf(one.theme),
    container: containerOf(one.containerTabId),
  }
}

function colourOf(theme: unknown): [number, number, number] | null {
  if (!isObject(theme)) return null

  const dots = list(theme.gradientColors)
  const dot = dots.find((one) => one.isPrimary === true) ?? dots[0]
  const c = dot?.c
  if (!Array.isArray(c) || c.length < 3) return null

  const rgb = c.slice(0, 3).map(Number)
  return rgb.every((one) => Number.isFinite(one)) ? (rgb as [number, number, number]) : null
}

function folderOf(one: Said): SidebarFolder | null {
  const id = text(one.id)
  if (!id) return null

  return {
    id,
    name: text(one.name) ?? 'Folder',
    icon: text(one.userIcon),
    parent: text(one.parentId),
    space: text(one.workspaceId),
    split: one.splitViewGroup === true,
  }
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

function idOf(one: Said): string | null {
  return text(one.zenSyncId) ?? text(one.zenPinnedId)
}

function tabsOf(tabs: Said[]): SidebarTab[] {
  const kept = new Map<string, SidebarTab | null>()

  tabs.forEach((one, at) => {
    if (flag(one.zenIsEmpty) || flag(one.zenIsGlance)) return
    const key = idOf(one) ?? `#${at}`
    if (!kept.get(key)) kept.set(key, tabOf(one))
  })

  return [...kept.values()].filter((one): one is SidebarTab => one !== null)
}

function pinnedEntry(one: Said): Said | null {
  const initial = isObject(one._zenPinnedInitialState) ? one._zenPinnedInitialState : null
  if (initial && isObject(initial.entry)) return initial.entry
  const older = parsed(one.zenPinnedEntry)
  return isObject(older) ? older : null
}

function tabOf(one: Said): SidebarTab | null {
  const entries = list(one.entries)
  const index = Math.min(Math.max(Number(one.index) || entries.length, 1), entries.length)
  const entry = entries[index - 1]
  const initial = isObject(one._zenPinnedInitialState) ? one._zenPinnedInitialState : null
  const first = pinnedEntry(one)

  const url = text(entry?.url) ?? text(one.userTypedValue) ?? text(first?.url)
  if (!url || url === 'about:blank') return null

  const essential = flag(one.zenEssential)
  const home = text(first?.url)

  return {
    title: text(one.zenStaticLabel) ?? text(entry?.title) ?? text(first?.title) ?? url,
    url,
    home: home && home !== url ? home : null,
    icon: siteMark(one.image) ?? siteMark(initial?.image) ?? siteMark(one.zenPinnedIcon),
    pinned: essential || flag(one.pinned),
    essential,
    space: essential ? null : text(one.zenWorkspace),
    folder: text(one.groupId),
    container: containerOf(one.userContextId),
  }
}

function pinnedIn(spaces: SidebarSpace[], folders: Said[], tabs: Said[], pins: Said[]): Sidebar {
  const pinOf = new Map<string, string>()
  for (const one of folders) {
    const id = text(one.id)
    const pin = text(one.pinId)
    if (id && pin) pinOf.set(id, pin)
  }
  const byPin = new Map<string, Said>()
  for (const one of tabs) {
    const id = text(one.zenPinnedId)
    if (id && !byPin.has(id)) byPin.set(id, one)
  }

  const rows = pins
    .map((one, at) => ({ one, at, position: Number(one.position) }))
    .sort(
      (a, b) =>
        Number(flag(b.one.is_essential)) - Number(flag(a.one.is_essential)) ||
        (Number.isFinite(a.position) ? a.position : 0) -
          (Number.isFinite(b.position) ? b.position : 0) ||
        a.at - b.at,
    )
    .map(({ one }) => one)

  const pinned = rows
    .filter((one) => !flag(one.is_group))
    .flatMap((pin): SidebarTab[] => {
      const id = text(pin.uuid)
      const held = id ? byPin.get(id) : undefined
      const read = held ? tabOf(held) : null
      const url = read?.url ?? text(pin.url)
      if (!url || url === 'about:blank') return []

      const essential = flag(pin.is_essential)
      const named = flag(pin.edited_title) ? text(pin.title) : null
      return [
        {
          title: named ?? read?.title ?? text(pin.title) ?? url,
          url,
          home: read?.home ?? null,
          icon: read?.icon ?? null,
          pinned: true,
          essential,
          space: essential ? null : text(pin.workspace_uuid),
          folder: text(pin.folder_parent_uuid),
          container: containerOf(pin.container_id),
        },
      ]
    })

  const pinIds = new Set(rows.map((one) => text(one.uuid)))
  const rest = tabsOf(tabs.filter((one) => !pinIds.has(text(one.zenPinnedId)))).map((tab) => ({
    ...tab,
    folder: tab.folder === null ? null : (pinOf.get(tab.folder) ?? tab.folder),
  }))

  const pinFolders = rows.filter((one) => flag(one.is_group)).flatMap(pinFolderOf)
  const made = new Set(pinFolders.map((one) => one.id))
  const others = folders
    .filter((one) => !made.has(pinOf.get(text(one.id) ?? '') ?? ''))
    .map(folderOf)
    .filter((one): one is SidebarFolder => one !== null)
  return { spaces, folders: [...pinFolders, ...others], tabs: [...pinned, ...rest] }
}

function pinFolderOf(pin: Said): SidebarFolder[] {
  const id = text(pin.uuid)
  if (!id) return []
  return [
    {
      id,
      name: text(pin.title) ?? 'Folder',
      icon: text(pin.folder_icon),
      parent: text(pin.folder_parent_uuid),
      space: text(pin.workspace_uuid),
      split: false,
    },
  ]
}

function containerOf(value: unknown): number {
  const said = Number(value)
  return Number.isInteger(said) && said > 0 ? said : 0
}
