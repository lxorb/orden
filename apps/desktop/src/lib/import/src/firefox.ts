import type { Sidebar } from './sidebar'
import {
  type FolderWords,
  isObject,
  list,
  Made,
  type Said,
  siteMark,
  type Step,
  text,
} from './sidebar-made'

const ROOTS: [string, keyof FolderWords][] = [
  ['toolbar_____', 'toolbar'],
  ['menu________', 'menu'],
  ['unfiled_____', 'other'],
  ['mobile______', 'mobile'],
]
const TAGS = 'tags________'

export function firefoxSidebar(
  session: unknown,
  bookmarks: unknown,
  name: string,
  words: FolderWords,
): Sidebar {
  const made = new Made()
  if (isObject(session)) {
    const open = readWindows(session, made, words)
    readSaved(list(session.savedGroups), open, made, words)
  }
  if (isObject(bookmarks)) readBookmarks(bookmarks, made, words)

  return made.sidebar(name)
}

function readWindows(session: Said, made: Made, words: FolderWords): Set<string> {
  const open = new Set<string>()
  const windows = list(session.windows).filter((one) => !one.isPrivate && !one.isPopup)
  for (const window of windows) {
    const groups = new Map(
      list(window.groups).flatMap((group) => {
        const id = text(group.id)
        return id ? [[id, text(group.name) ?? words.group] as const] : []
      }),
    )
    for (const id of groups.keys()) open.add(id)

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
  return open
}

function readSaved(saved: Said[], open: Set<string>, made: Made, words: FolderWords) {
  for (const group of saved) {
    const id = text(group.id)
    if (!id || open.has(id)) continue
    made.folder('saved', words.savedGroups, null)
    made.folder(`saved:${id}`, text(group.name) ?? words.group, 'saved')

    for (const one of list(group.tabs)) {
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

function pageOf(tab: Said): { title: string; url: string; icon: string | null } | null {
  const entries = list(tab.entries)
  const index = Math.min(Math.max(Number(tab.index) || entries.length, 1), entries.length)
  const entry = entries[index - 1]
  const url = text(entry?.url) ?? text(tab.userTypedValue)
  if (!url) return null
  return { title: text(entry?.title) ?? url, url, icon: siteMark(tab.image) }
}

function containerOf(value: unknown): number {
  const said = Number(value)
  return Number.isInteger(said) && said > 0 ? said : 0
}

const ROOT_NAMES: Record<string, string> = {
  toolbarFolder: 'toolbar_____',
  bookmarksMenuFolder: 'menu________',
  unfiledBookmarksFolder: 'unfiled_____',
  mobileFolder: 'mobile______',
  tagsFolder: TAGS,
}

function rootOf(node: Said): string | null {
  const named = typeof node.root === 'string' ? ROOT_NAMES[node.root] : undefined
  return named ?? text(node.guid)
}

export type Spacing = (guid: string | null, around: string) => string

export function readBookmarks(
  root: Said,
  made: Made,
  words: FolderWords,
  spacing: Spacing = (_, around) => around,
) {
  const roots = list(root.children).filter((one) => rootOf(one) !== TAGS)
  const known = ROOTS.flatMap(([guid, word]) => {
    const found = roots.find((one) => rootOf(one) === guid)
    return found ? [{ node: found, name: words[word] }] : []
  })
  const others = roots
    .filter((one) => !ROOTS.some(([guid]) => guid === rootOf(one)))
    .map((node) => ({ node, name: text(node.title) ?? words.other }))

  const top: Step = { key: 'bookmarks', name: words.bookmarks }
  for (const { node, name } of [...known, ...others]) {
    const steps = [top, { key: `bookmark:${rootOf(node) ?? name}`, name }]
    walk(node, steps, made, words, spacing, spacing(text(node.guid), made.space), 0)
  }
}

const DEEPEST = 64

function walk(
  folder: Said,
  steps: readonly Step[],
  made: Made,
  words: FolderWords,
  spacing: Spacing,
  space: string,
  depth: number,
) {
  if (depth > DEEPEST) return
  list(folder.children).forEach((node, at) => {
    const kind = kindOf(node)
    const here = spacing(text(node.guid), space)
    if (kind === BOOKMARK) {
      const url = text(node.uri)
      if (!url) return
      made.tab({
        title: text(node.title) ?? url,
        url,
        icon: null,
        pinned: false,
        folder: made.within(steps, here),
        container: 0,
        space: here,
        ...addedOf(node.dateAdded),
      })
    } else if (kind === FOLDER) {
      const key = `bookmark:${text(node.guid) ?? `${steps.at(-1)?.key ?? ''}/${String(at)}`}`
      const inner = [...steps, { key, name: text(node.title) ?? words.other }]
      walk(node, inner, made, words, spacing, here, depth + 1)
    }
  })
}

const BOOKMARK = 1
const FOLDER = 2

function kindOf(node: Said): number | null {
  if (typeof node.typeCode === 'number') return node.typeCode
  if (node.type === 'text/x-moz-place') return BOOKMARK
  if (node.type === 'text/x-moz-place-container') return FOLDER
  return null
}

function addedOf(value: unknown): { added?: Date } {
  const micro = Number(value)
  if (!Number.isFinite(micro) || micro <= 0) return {}
  const when = new Date(Math.floor(micro / 1000))
  return Number.isNaN(when.getTime()) ? {} : { added: when }
}
