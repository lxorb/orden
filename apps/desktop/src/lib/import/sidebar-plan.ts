import { Names, safeName } from './names'
import type { Planned } from './plan'
import type { Sidebar, SidebarFolder, SidebarSpace, SidebarTab } from './sidebar'
import { zenIcon, zenTint } from './zen-icons'
import { isWebAddress } from '../web-tab/address'
import { writeShortcut } from '@orden/scan/shortcut'
import { readIcon, takesTint } from '../icons'

export interface SpacePlan {
  name: string
  icon: string | null
  tint: string | null
  files: Planned[]
  order: Record<string, string[]>
  bookmarks: string[]
  folderIcons: Record<string, string>
}

interface SidebarImport {
  spaces: SpacePlan[]
  lost: string[]
}

const LONGEST_MARK = 64 * 1024

export function sidebarImport(
  session: Sidebar,
  now: Date,
  containers: string | null,
): SidebarImport {
  const first = session.spaces[0]
  const homeOf = (tab: SidebarTab): string | undefined => {
    const own = session.spaces.find((space) => space.id === tab.space)
    const contained =
      tab.essential && tab.container
        ? session.spaces.find((space) => space.container === tab.container)
        : undefined
    return (own ?? contained ?? first)?.id
  }

  const container = session.tabs.some((tab) => tab.container > 0)
  return {
    spaces: session.spaces.map((space) =>
      spacePlan(
        space,
        session.folders,
        session.tabs.filter((tab) => homeOf(tab) === space.id && isWebAddress(tab.url)),
        now,
      ),
    ),
    lost:
      containers && (container || session.spaces.some((space) => space.container > 0))
        ? [containers]
        : [],
  }
}

type Row = { tab: SidebarTab } | { folder: SidebarFolder; rows: Row[] }

function spacePlan(
  space: SidebarSpace,
  folders: readonly SidebarFolder[],
  tabs: readonly SidebarTab[],
  now: Date,
): SpacePlan {
  const icon = zenIcon(space.icon)
  const plan: SpacePlan = {
    name: space.name,
    icon,
    tint: takesTint(readIcon(icon)) ? zenTint(space.colour) : null,
    files: [],
    order: {},
    bookmarks: [],
    folderIcons: {},
  }

  const rows = rowsOf(space, folders, tabs)
  write(rows, '', plan, new Names(), now)
  return plan
}

function rowsOf(
  space: SidebarSpace,
  folders: readonly SidebarFolder[],
  tabs: readonly SidebarTab[],
): Row[] {
  const byId = new Map(folders.filter((one) => one.id).map((one) => [one.id, one]))
  const top: Row[] = []
  const made = new Map<string, Row[]>()

  const rowsIn = (id: string | null, seen = new Set<string>()): Row[] => {
    const folder = id ? byId.get(id) : undefined
    if (!folder || seen.has(folder.id) || (folder.space && folder.space !== space.id)) return top
    seen.add(folder.id)
    if (folder.split) return rowsIn(folder.parent, seen)

    const held = made.get(folder.id)
    if (held) return held
    const rows: Row[] = []
    made.set(folder.id, rows)
    rowsIn(folder.parent, seen).push({ folder, rows })
    return rows
  }

  const pages = new WeakMap<Row[], Set<string>>()
  const add = (rows: Row[], tab: SidebarTab) => {
    const held = pages.get(rows) ?? new Set<string>()
    pages.set(rows, held)
    if (held.has(tab.url)) return
    held.add(tab.url)
    rows.push({ tab })
  }

  for (const tab of tabs) if (tab.essential) add(top, tab)
  for (const tab of tabs) if (!tab.essential) add(rowsIn(tab.folder), tab)
  for (const folder of folders) if (folder.space === space.id) rowsIn(folder.id)

  return top
}

function write(rows: readonly Row[], folder: string, plan: SpacePlan, names: Names, now: Date) {
  const order: string[] = []
  const inside = (name: string) => (folder ? `${folder}/${name}` : name)

  for (const row of rows) {
    if ('tab' in row) {
      const path = names.free(inside(`${safeName(row.tab.title)}.url`))
      plan.files.push({ kind: 'note', path, text: shortcutOf(row.tab, now) })
      if (row.tab.essential) plan.bookmarks.push(path)
      order.push(nameIn(path))
      continue
    }

    const name = safeName(row.folder.name)
    if (!row.rows.length) {
      const path = names.free(`${names.free(inside(name))}.md`)
      plan.files.push({ kind: 'note', path, text: '' })
      order.push(nameIn(path))
      continue
    }

    const path = names.free(inside(name))
    const icon = zenIcon(row.folder.icon)
    if (icon) plan.folderIcons[path] = icon
    order.push(nameIn(path))
    write(row.rows, path, plan, names, now)
  }

  plan.order[folder] = order
}

function nameIn(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function shortcutOf(tab: SidebarTab, now: Date): string {
  const home = tab.home && isWebAddress(tab.home) ? tab.home : null
  const mark =
    tab.icon?.startsWith('data:image/') && tab.icon.length <= LONGEST_MARK ? tab.icon : null
  return writeShortcut(tab.url, tab.title, tab.added ?? now, home, mark)
}
