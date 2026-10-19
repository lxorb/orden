/** What Safari keeps on a Mac, read into a browser's sidebar (sidebar.ts): its open
 *  tabs, its pinned ones, its tab groups, its bookmarks and its Reading List. The crate
 *  hands the files over as JSON (safari.rs); this reads them.
 *
 *  The tabs are `SafariTabs.db`'s rows (Safari 15 on), a tree of folders (type 1) and
 *  tabs (type 0) in `order_index` order:
 *
 *  - **A tab group** is a folder that holds tabs, and becomes a folder of its name.
 *  - **Pinned tabs** are kept in a tab group's `TopScopedBookmarkList`, and are the
 *    Essentials, as Firefox's and Chrome's pinned tabs are.
 *  - **A window's own tabs**, the group nobody named, are in a folder Safari calls
 *    `Local`, and come at the top of the space rather than in a folder.
 *  - Folders that only hold folders - the root, a profile - hold nothing of their own,
 *    and a row marked deleted, or a folder of Safari's own (`com.apple.…`), is nothing.
 *
 *  Before Safari 15 the open windows are `LastSession.plist`: `SessionWindows`, each
 *  with its `TabStates`, the pinned ones `IsAppTab`, a private window never.
 *
 *  The bookmarks are `Bookmarks.plist`, a tree of lists (`WebBookmarkTypeList`, a
 *  `Title` and `Children`) and bookmarks (`WebBookmarkTypeLeaf`, a `URLString` and a
 *  `URIDictionary.title`), and come as Firefox's and Chrome's do: a folder called
 *  Bookmarks after the tabs, with Favorites (Safari's own name for its bar) and the
 *  Bookmarks menu in it, and every other list of the root by its title. The Reading
 *  List, the root's `com.apple.ReadingList`, is a folder of its own after that, each
 *  page kept on the day it was added. History is a list of the root too, and stays.
 *
 *  Pure: the files as the crate read them, the sidebar out. */

import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, text } from './sidebar-made'

/** What the crate read: each file, or null where it was not there. */
export interface SafariFiles {
  bookmarks: unknown
  tabs: unknown
  session: unknown
}

/** Safari's folders in `SafariTabs.db` that are not tab groups. */
const PINNED = 'TopScopedBookmarkList'
const LOCAL = 'Local'

/** The root's lists in `Bookmarks.plist`, by their fixed titles. */
const BAR = 'BookmarksBar'
const MENU = 'BookmarksMenu'
const READING_LIST = 'com.apple.ReadingList'

const FOLDER = 1
const TAB = 0

/** Safari as one space named `name`. */
export function safariSidebar(files: SafariFiles, name: string, words: FolderWords): Sidebar {
  const made = new Made()
  if (Array.isArray(files.tabs)) readTabs(files.tabs.filter(isObject), made, words)
  else if (isObject(files.session)) readSession(files.session, made)
  if (isObject(files.bookmarks)) readBookmarks(files.bookmarks, made, words)
  return made.sidebar(name)
}

/** One row of `SafariTabs.db`, as the crate reads it. */
interface Row {
  id: number
  parent: number | null
  type: number | null
  title: string
  url: string
}

function rowOf(said: Said): Row | null {
  if (said.deleted === true || typeof said.id !== 'number') return null
  return {
    id: said.id,
    parent: typeof said.parent === 'number' ? said.parent : null,
    type: typeof said.type === 'number' ? said.type : null,
    title: text(said.title) ?? '',
    url: text(said.url) ?? '',
  }
}

/** Deeper than Safari nests, and a stop for a table whose parents go round. */
const DEEPEST = 16

/** The tab groups and their tabs, walked from the rows nothing holds. The crate reads
 *  them in Safari's order, so a folder's children are in the order Safari shows them. */
function readTabs(said: Said[], made: Made, words: FolderWords) {
  const rows = said.map(rowOf).filter((one): one is Row => one !== null)
  const ids = new Set(rows.map((one) => one.id))
  const inside = new Map<number | null, Row[]>()
  for (const row of rows) {
    const parent = row.parent !== null && ids.has(row.parent) ? row.parent : null
    inside.set(parent, [...(inside.get(parent) ?? []), row])
  }
  const tabsIn = (folder: Row) => (inside.get(folder.id) ?? []).filter((one) => one.type === TAB)

  const walk = (parent: number | null, depth: number) => {
    if (depth > DEEPEST) return
    for (const folder of inside.get(parent) ?? []) {
      if (folder.type !== FOLDER || folder.title.startsWith('com.apple.')) continue
      if (folder.title === PINNED) {
        for (const tab of tabsIn(folder)) page(made, tab, { essential: true })
        continue
      }
      const tabs = tabsIn(folder)
      if (tabs.length && folder.title !== LOCAL) {
        const id = `group:${String(folder.id)}`
        made.folder(id, folder.title || words.group, null)
        for (const tab of tabs) page(made, tab, { folder: id })
      } else {
        for (const tab of tabs) page(made, tab, {})
      }
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
}

/** A tab as a page of the sidebar; one with no address is a blank tab, and nothing. */
function page(made: Made, tab: Row, where: { folder?: string; essential?: boolean }) {
  if (!tab.url) return
  made.tab({
    title: tab.title,
    url: tab.url,
    icon: null,
    pinned: where.essential ?? false,
    essential: where.essential ?? false,
    folder: where.folder ?? null,
    container: 0,
  })
}

/** An older Safari's windows. */
function readSession(session: Said, made: Made) {
  for (const window of list(session.SessionWindows)) {
    if (window.IsPrivateWindow === true) continue
    for (const tab of list(window.TabStates)) {
      const url = text(tab.TabURL)
      if (!url) continue
      const pinned = tab.IsAppTab === true
      made.tab({
        title: text(tab.TabTitle) ?? url,
        url,
        icon: null,
        pinned,
        essential: pinned,
        folder: null,
        container: 0,
      })
    }
  }
}

/** The bookmarks under Bookmarks, and the Reading List after them. */
function readBookmarks(root: Said, made: Made, words: FolderWords) {
  const lists = list(root.Children).filter((one) => one.WebBookmarkType === 'WebBookmarkTypeList')
  const named = (title: string | null) =>
    title === BAR ? words.favorites : title === MENU ? words.menu : (title ?? words.other)

  for (const one of lists.filter((each) => text(each.Title) !== READING_LIST)) {
    made.folder('bookmarks', words.bookmarks, null)
    const id = `bookmark:${text(one.WebBookmarkUUID) ?? named(text(one.Title))}`
    made.folder(id, named(text(one.Title)), 'bookmarks')
    walk(one, id, made, words, 0)
  }

  const reading = lists.find((each) => text(each.Title) === READING_LIST)
  if (reading) {
    made.folder('reading', words.readingList, null)
    walk(reading, 'reading', made, words, 0)
  }
}

function walk(folder: Said, id: string, made: Made, words: FolderWords, depth: number) {
  if (depth > DEEPEST) return
  list(folder.Children).forEach((node, at) => {
    if (node.WebBookmarkType === 'WebBookmarkTypeLeaf') {
      const url = text(node.URLString)
      if (!url) return
      const titled = isObject(node.URIDictionary) ? text(node.URIDictionary.title) : null
      made.tab({
        title: titled ?? url,
        url,
        icon: null,
        pinned: false,
        folder: id,
        container: 0,
        ...addedOf(isObject(node.ReadingList) ? node.ReadingList.DateAdded : undefined),
      })
    } else if (node.WebBookmarkType === 'WebBookmarkTypeList') {
      const inner = `bookmark:${text(node.WebBookmarkUUID) ?? `${id}/${String(at)}`}`
      made.folder(inner, text(node.Title) ?? words.other, id)
      walk(node, inner, made, words, depth + 1)
    }
  })
}

/** The day a page was put on the Reading List, as the crate writes a date. */
function addedOf(value: unknown): { added?: Date } {
  if (typeof value !== 'string') return {}
  const when = new Date(value)
  return Number.isNaN(when.getTime()) ? {} : { added: when }
}
