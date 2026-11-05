/** What Zen's own session file says: its spaces, its folders and its tabs, in the
 *  order its sidebar draws them.
 *
 *  Zen is Firefox underneath, and keeps the sidebar - every space, pinned tab,
 *  Essential and folder - in `zen-sessions.jsonlz4` in the profile, one object
 *  `{ spaces, tabs, folders, groups }` shared by every window. Before that file
 *  existed, and in Firefox's own `recovery.jsonlz4` still, the same four lists sit
 *  on each window, `{ windows: [{ spaces, tabs, folders }] }`; both are read here,
 *  so a profile that has not yet written the newer file still imports. See Zen's
 *  ZenSessionManager.sys.mjs, TabState.sys.mjs and ZenFolders.mjs.
 *
 *  - **A space** is `{ uuid, name, icon, position, containerTabId, theme }`. The
 *    icon is an emoji or one of Zen's own drawings, a `chrome://` address.
 *  - **A tab** is Firefox's tab state with Zen's fields on it: `zenWorkspace` (its
 *    space), `zenEssential`, `pinned`, `groupId` (the folder it is in),
 *    `zenStaticLabel` (a name somebody gave it), `zenIsEmpty` (the stand-in an
 *    empty folder holds), `zenIsGlance` (a page peeked at over another), and
 *    `_zenPinnedInitialState`, the address a pinned tab goes back to.
 *  - **A folder** is a tab group with `{ id, name, parentId, userIcon, workspaceId }`;
 *    a split view inside a folder is listed among them as `splitViewGroup`.
 *
 *  Zen up to 1.17 kept less of it there. Its session has the tabs and the folders
 *  but no spaces, and wrote `zenEssential` as the attribute's own `"true"` (as a
 *  twilight build of 1.18 still did in `zen-sessions.jsonlz4`), its tab's id as
 *  `zenPinnedId` and the address a pinned tab goes back to as `zenPinnedEntry`. The
 *  spaces are rows of `zen_workspaces` in `places.sqlite`, and every pinned tab and
 *  Essential a row of `zen_pins` - the only place a pinned tab of a space not open
 *  as the session was written is - which the crate reads (zen_profiles.rs) and
 *  which come in here as `ZenPlaces`.
 *
 *  Zen's bookmarks are Firefox's, and come as Firefox's do (firefox.ts), in a folder
 *  called Bookmarks: in the first space, or for one Zen shows only in some spaces
 *  (`zen_bookmarks_workspaces`), in the first of those.
 *
 *  Pure: the crate hands over the bytes, mozlz4.ts unpacks them, and this reads
 *  what came out. Anything it does not recognise is stepped over rather than
 *  refused, because the file is another program's and it changes with its releases.
 *  What it reads into is every browser's one shape; see sidebar.ts. */

import { readBookmarks } from './firefox'
import type { Sidebar, SidebarFolder, SidebarSpace, SidebarTab } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, siteMark, text } from './sidebar-made'

export type ZenSession = Sidebar

/** What Zen keeps in `places.sqlite`, each a table's rows by their column names; see
 *  zen_profiles.rs. Any of them empty where the table is not there. */
export interface ZenPlaces {
  /** `zen_workspaces`: the spaces, up to 1.17. */
  spaces: unknown[]
  /** `zen_pins`: the pinned tabs, the Essentials and the folders, up to 1.17. */
  pins: unknown[]
  /** The bookmarks, as firefox_profiles.rs reads them. */
  bookmarks: unknown
  /** `zen_bookmarks_workspaces`: which spaces a bookmark is shown in. */
  assigned: unknown[]
}

/** The sidebar out of what was in the file, or null when it holds no spaces: a
 *  session from a Firefox, or a file Zen had not finished writing. `places` is
 *  what a Zen up to 1.17 kept its spaces and pins in. */
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

/** The sidebar with Zen's bookmarks after everything else, each in the space it is
 *  shown in; see the top of this file. */
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

/** The spaces in the order the switcher shows them: by their position, where they
 *  have one, and in the order they were listed. */
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

/** The sidebar's lists off the windows of a Firefox session: the spaces and the
 *  folders of the first window that has any, which every window shares, and the
 *  tabs of all of them, since a window may hold tabs another does not. A Zen up to
 *  1.17 wrote no spaces there, and then the first window's folders are the ones.
 *  Never a private window's: nothing of one is anybody's to keep. */
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

/** A row of `zen_workspaces` as the space a session would have written. */
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

/** The theme's main colour: the dot marked primary, or the first one. Each is
 *  `{ c: [r, g, b] }`; a colour somebody typed is a CSS string, which says nothing
 *  a tint could use. */
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

/** A flag as Zen wrote it: `true`, or the attribute's own `"true"` before 1.18. */
function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

/** A tab's own id, which it keeps in every window: `zenSyncId`, or `zenPinnedId`
 *  before 1.18, which only a pinned tab had. */
function idOf(one: Said): string | null {
  return text(one.zenSyncId) ?? text(one.zenPinnedId)
}

/** Every tab worth a row, each once. A tab is in the file once per window that
 *  holds it, under one id, and the copy that has a page wins over a blank one,
 *  which is how Zen chooses too. The stand-in an empty folder keeps and a page
 *  peeked at over another are not tabs anybody opened. */
function tabsOf(tabs: Said[]): SidebarTab[] {
  const kept = new Map<string, SidebarTab | null>()

  tabs.forEach((one, at) => {
    if (flag(one.zenIsEmpty) || flag(one.zenIsGlance)) return
    // A tab with no id of its own is a tab of its own.
    const key = idOf(one) ?? `#${at}`
    if (!kept.get(key)) kept.set(key, tabOf(one))
  })

  return [...kept.values()].filter((one): one is SidebarTab => one !== null)
}

/** The address a pinned tab goes back to: `_zenPinnedInitialState`'s entry, or
 *  before 1.18 `zenPinnedEntry`, the same entry written out as JSON. */
function pinnedEntry(one: Said): Said | null {
  const initial = isObject(one._zenPinnedInitialState) ? one._zenPinnedInitialState : null
  if (initial && isObject(initial.entry)) return initial.entry
  const older = parsed(one.zenPinnedEntry)
  return isObject(older) ? older : null
}

/** One tab, or null for one with no page: Firefox's `entries` are the tab's
 *  history and `index` counts from one to the page it is on. */
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

/** A Zen up to 1.17's sidebar: its pinned tabs and Essentials out of `zen_pins`, in
 *  their order, each with the page its tab in the session is on where it has one,
 *  then the session's other tabs. A pinned folder is a pin too (`is_group`), which
 *  the session's folder names by its `pinId`. */
function pinnedIn(spaces: SidebarSpace[], folders: Said[], tabs: Said[], pins: Said[]): Sidebar {
  // The session's folders by the pin each is, which is what a pin's folder is called.
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

/** A container's number, which Firefox calls a user context: nought is none. */
function containerOf(value: unknown): number {
  const said = Number(value)
  return Number.isInteger(said) && said > 0 ? said : 0
}
