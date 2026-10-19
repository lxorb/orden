/** A browser's sidebar as nib's: what each of its spaces becomes before anything is
 *  written. What becomes what is Zen's picture, which every browser's sidebar is read
 *  into (sidebar.ts); see zen-plan.ts for why each thing becomes what it does. A tab
 *  a browser says when it kept, a bookmark, says that day as the day it was kept.
 *
 *  Pure: the sidebar in, the plans out. See sidebar-landing.ts for the writing. */

import { Names, safeName } from './names'
import type { Lost, Planned } from './plan'
import type { Sidebar, SidebarFolder, SidebarSpace, SidebarTab } from './sidebar'
import { zenIcon, zenTint } from './zen-icons'
import { isWebAddress } from '../web-tab/address'
import { writeShortcut } from '../web-tab/shortcut'
import { readIcon } from '../icons'

/** One of the browser's spaces as a nib space. */
export interface SpacePlan {
  name: string
  icon: string | null
  /** Only with a stroked icon: an emoji has its own colours. */
  tint: string | null
  /** Every web note and empty note, as paths inside the space, in the sidebar's order. */
  files: Planned[]
  /** Each folder's rows in the sidebar's order, by the folder's path ('' for the top). */
  order: Record<string, string[]>
  /** The Essentials, as paths of their web notes. */
  bookmarks: string[]
  /** The icons the browser's folders wore, by the folder's path. */
  folderIcons: Record<string, string>
}

interface SidebarImport {
  spaces: SpacePlan[]
  lost: Lost[]
}

/** The largest site mark kept in a web note: a favicon is a few kilobytes, and a
 *  picture past this is a page's screenshot somebody's session kept by accident. */
const LONGEST_MARK = 64 * 1024

/** What nib makes of a sidebar. `now` is when the web notes say they were kept, where
 *  the browser did not say; `containers` is the line that says containers stayed
 *  behind, in the browser's name, or null for a browser that has none. */
export function sidebarImport(session: Sidebar, now: Date, containers: Lost | null): SidebarImport {
  const first = session.spaces[0]
  // A tab whose space is not in the list is in the first one, which is where Zen
  // shows a tab it has lost the space of.
  const homeOf = (tab: SidebarTab): string | undefined => {
    const own = session.spaces.find((space) => space.id === tab.space)
    // Essentials are shown in every space, or in every space of their container.
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

/** A row of the sidebar: a tab, or a folder of rows. */
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
    tint: icon && readIcon(icon)?.kind === 'lucide' ? zenTint(space.colour) : null,
    files: [],
    order: {},
    bookmarks: [],
    folderIcons: {},
  }

  const rows = rowsOf(space, folders, tabs)
  write(rows, '', plan, new Names(), now)
  return plan
}

/** The space's rows as the sidebar nests them. Essentials first, which is where
 *  they are drawn, then everything else in the session's order: a folder sits where
 *  its first tab does, and a folder of nothing at the end of the folder it is in,
 *  in the order the folders are listed. */
function rowsOf(
  space: SidebarSpace,
  folders: readonly SidebarFolder[],
  tabs: readonly SidebarTab[],
): Row[] {
  const byId = new Map(folders.filter((one) => one.id).map((one) => [one.id, one]))
  const top: Row[] = []
  const made = new Map<string, Row[]>()

  /** The rows of a folder, made in its parent's rows the first time it is asked. A
   *  split view is not a folder: its rows are its folder's. A chain that loops, or
   *  a folder of another space, ends at the top. */
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

  const essentials = tabs.filter((tab) => tab.essential)
  for (const tab of essentials) top.push({ tab })
  for (const tab of tabs) if (!tab.essential) rowsIn(tab.folder).push({ tab })
  for (const folder of folders) if (folder.space === space.id) rowsIn(folder.id)

  return top
}

/** The rows as files, each folder's order written down as they go. */
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
      // Its name is taken as a folder's too: a note beside a folder of the same name
      // is the note nib nests into that folder (folder-notes.ts), not a second one.
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

/** A tab as a web note: its page now, the address it was pinned on, and its mark
 *  where the session kept it as a picture. */
function shortcutOf(tab: SidebarTab, now: Date): string {
  const home = tab.home && isWebAddress(tab.home) ? tab.home : null
  const mark =
    tab.icon?.startsWith('data:image/') && tab.icon.length <= LONGEST_MARK ? tab.icon : null
  return writeShortcut(tab.url, tab.title, tab.added ?? now, home, mark)
}
