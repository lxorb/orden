import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, text } from './sidebar-made'

export interface SafariFiles {
  bookmarks: unknown
  tabs: unknown
  session: unknown
}

const PINNED = 'TopScopedBookmarkList'
const LOCAL = 'Local'
const PRIVATE = new Set(['private', 'privatepinned'])

const BAR = 'BookmarksBar'
const MENU = 'BookmarksMenu'
const READING_LIST = 'com.apple.ReadingList'

const FOLDER = 1
const TAB = 0

export function safariSidebar(files: SafariFiles, name: string, words: FolderWords): Sidebar {
  const made = new Made()
  if (Array.isArray(files.tabs)) readTabs(files.tabs.filter(isObject), made, words)
  else if (isObject(files.session)) readSession(files.session, made)
  if (isObject(files.bookmarks)) readBookmarks(files.bookmarks, made, words)
  return made.sidebar(name)
}

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

const DEEPEST = 16

function readTabs(said: Said[], made: Made, words: FolderWords) {
  const rows = said.map(rowOf).filter((one): one is Row => one !== null)
  const ids = new Set(rows.map((one) => one.id))
  const inside = new Map<number | null, Row[]>()
  for (const row of rows) {
    const parent = row.parent !== null && ids.has(row.parent) ? row.parent : null
    const gathered = inside.get(parent)
    if (gathered) gathered.push(row)
    else inside.set(parent, [row])
  }
  const tabsIn = (folder: Row) => (inside.get(folder.id) ?? []).filter((one) => one.type === TAB)

  const walk = (parent: number | null, depth: number) => {
    if (depth > DEEPEST) return
    for (const folder of inside.get(parent) ?? []) {
      if (folder.type !== FOLDER || folder.title.startsWith('com.apple.')) continue
      if (PRIVATE.has(folder.title.toLowerCase())) continue
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

function addedOf(value: unknown): { added?: Date } {
  if (typeof value !== 'string') return {}
  const when = new Date(value)
  return Number.isNaN(when.getTime()) ? {} : { added: when }
}
