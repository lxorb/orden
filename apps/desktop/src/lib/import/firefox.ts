/** What Firefox's own files say, read into a browser's sidebar (sidebar.ts): its open
 *  tabs, the pinned ones, its tab groups and the groups it saved, and its bookmarks.
 *
 *  Firefox has no spaces, so a profile is one space. Of its session - `{ windows,
 *  savedGroups }` out of `recovery.jsonlz4` - every window that is not private is
 *  read, the tabs in their order, each tab's page the one its history is on:
 *
 *  - **A pinned tab** is one of the Essentials, which is what nib's are for: what
 *    stays put above everything else.
 *  - **A tab group** is a folder of its name (`groups: [{ id, name, color }]` on the
 *    window, `groupId` on its tabs), where its first tab is. Its colour has nothing to
 *    become.
 *  - **A saved group**, one closed and kept, is a folder of its name in a folder
 *    called Saved groups, after the open tabs.
 *  - **The bookmarks** are a folder called Bookmarks after everything else, with a
 *    folder for each of Firefox's roots that holds any - the toolbar, the menu, the
 *    other bookmarks and the phone's - and every folder in them a folder, each
 *    bookmark a web note kept on the day it was bookmarked. The tags, which list the
 *    same bookmarks again, and the separators are not anything.
 *
 *  Only pages on the web: an `about:` page, a file, an extension's page, a smart
 *  folder's `place:` query and a bookmarklet are not somewhere a web note can point.
 *  A folder with none of those in it is not made. Containers are the tab's
 *  `userContextId`, which sidebar-plan.ts says stay behind.
 *
 *  Pure: the files as they were parsed in, the sidebar out. The bookmarks are the tree
 *  Firefox writes its daily backups as, which is also what the crate reads out of
 *  `places.sqlite` (firefox_profiles.rs). Anything not recognised is stepped over. */

import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, text } from './sidebar-made'

/** Firefox's roots, by their fixed ids, in the order its library shows them. */
const ROOTS: [string, keyof FolderWords][] = [
  ['toolbar_____', 'toolbar'],
  ['menu________', 'menu'],
  ['unfiled_____', 'other'],
  ['mobile______', 'mobile'],
]
const TAGS = 'tags________'

/** A profile as one space named `name`: its session's tabs and groups, then its
 *  saved groups, then its bookmarks. Either may be null, for a file that was not
 *  there or did not read. */
export function firefoxSidebar(
  session: unknown,
  bookmarks: unknown,
  name: string,
  words: FolderWords,
): Sidebar {
  const made = new Made()
  if (isObject(session)) {
    readWindows(session, made, words)
    readSaved(list(session.savedGroups), made, words)
  }
  if (isObject(bookmarks)) readBookmarks(bookmarks, made, words)

  return made.sidebar(name)
}

/** The open windows' tabs in their order, and the groups they are in. Never a private
 *  window's, nor a popup's. */
function readWindows(session: Said, made: Made, words: FolderWords) {
  const windows = list(session.windows).filter((one) => !one.isPrivate && !one.isPopup)
  for (const window of windows) {
    const groups = new Map(
      list(window.groups).flatMap((group) => {
        const id = text(group.id)
        return id ? [[id, text(group.name) ?? words.group] as const] : []
      }),
    )

    for (const tab of list(window.tabs)) {
      const page = pageOf(tab)
      if (!page) continue
      const group = text(tab.groupId)
      const named = group ? groups.get(group) : undefined
      if (group && named !== undefined) made.folder(`group:${group}`, named, null)

      const pinned = tab.pinned === true
      made.tab({
        ...page,
        pinned,
        essential: pinned,
        folder: group && named !== undefined ? `group:${group}` : null,
        container: containerOf(tab.userContextId),
      })
    }
  }
}

/** The groups Firefox saved, each a folder in Saved groups, its tabs in it. */
function readSaved(saved: Said[], made: Made, words: FolderWords) {
  for (const group of saved) {
    const id = text(group.id)
    if (!id) continue
    made.folder('saved', words.savedGroups, null)
    made.folder(`saved:${id}`, text(group.name) ?? words.group, 'saved')

    for (const one of list(group.tabs)) {
      // A saved tab is kept the way a closed one is: its state beside what was said of it.
      const tab = isObject(one.state) ? one.state : one
      const page = pageOf(tab)
      if (!page) continue
      made.tab({
        ...page,
        pinned: false,
        folder: `saved:${id}`,
        container: containerOf(tab.userContextId),
      })
    }
  }
}

/** A tab's page: its history is `entries`, and `index` counts from one to the page it
 *  is on. A tab that never loaded says what was typed into it. */
function pageOf(tab: Said): { title: string; url: string; icon: string | null } | null {
  const entries = list(tab.entries)
  const index = Math.min(Math.max(Number(tab.index) || entries.length, 1), entries.length)
  const entry = entries[index - 1]
  const url = text(entry?.url) ?? text(tab.userTypedValue)
  if (!url) return null
  return { title: text(entry?.title) ?? url, url, icon: text(tab.image) }
}

/** A container's number, which Firefox calls a user context: nought is none. */
function containerOf(value: unknown): number {
  const said = Number(value)
  return Number.isInteger(said) && said > 0 ? said : 0
}

/** The bookmark tree, each of Firefox's roots a folder in Bookmarks. */
function readBookmarks(root: Said, made: Made, words: FolderWords) {
  const roots = list(root.children).filter((one) => text(one.guid) !== TAGS)
  const known = ROOTS.flatMap(([guid, word]) => {
    const found = roots.find((one) => one.guid === guid)
    return found ? [{ node: found, name: words[word] }] : []
  })
  const others = roots
    .filter((one) => !ROOTS.some(([guid]) => guid === one.guid))
    .map((node) => ({ node, name: text(node.title) ?? words.other }))

  for (const { node, name } of [...known, ...others]) {
    made.folder('bookmarks', words.bookmarks, null)
    const id = `bookmark:${text(node.guid) ?? name}`
    made.folder(id, name, 'bookmarks')
    walk(node, id, made, words, 0)
  }
}

/** Deeper than anybody nests, and a stop for a tree that goes round. */
const DEEPEST = 64

function walk(folder: Said, id: string, made: Made, words: FolderWords, depth: number) {
  if (depth > DEEPEST) return
  list(folder.children).forEach((node, at) => {
    if (node.typeCode === 1) {
      const url = text(node.uri)
      if (!url) return
      made.tab({
        title: text(node.title) ?? url,
        url,
        icon: null,
        pinned: false,
        folder: id,
        container: 0,
        ...addedOf(node.dateAdded),
      })
    } else if (node.typeCode === 2) {
      const inner = `bookmark:${text(node.guid) ?? `${id}/${String(at)}`}`
      made.folder(inner, text(node.title) ?? words.other, id)
      walk(node, inner, made, words, depth + 1)
    }
  })
}

/** When a bookmark was made: Firefox counts microseconds since 1970. */
function addedOf(value: unknown): { added?: Date } {
  const micro = Number(value)
  if (!Number.isFinite(micro) || micro <= 0) return {}
  const when = new Date(Math.floor(micro / 1000))
  return Number.isNaN(when.getTime()) ? {} : { added: when }
}
