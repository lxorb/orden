import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, text } from './sidebar-made'
import type { SnssSession } from './snss'

const ROOTS: [string, keyof FolderWords][] = [
  ['bookmark_bar', 'bar'],
  ['other', 'other'],
  ['synced', 'mobile'],
]

export function chromiumSidebar(
  session: SnssSession | null,
  bookmarks: unknown,
  name: string,
  words: FolderWords,
  account: unknown = null,
): Sidebar {
  const made = new Made()
  if (session) readWindows(session, made, words)
  readBookmarks([rootsOf(account, 'account:'), rootsOf(bookmarks, '')], made, words)
  return made.sidebar(name)
}

function rootsOf(file: unknown, prefix: string): { roots: Said; prefix: string } | null {
  return isObject(file) && isObject(file.roots) ? { roots: file.roots, prefix } : null
}

function readWindows(session: SnssSession, made: Made, words: FolderWords) {
  for (const window of session.windows) {
    for (const tab of window.tabs) {
      const group = tab.group === null ? null : `group:${tab.group}`
      if (group !== null && tab.group !== null) {
        const named = session.groups.get(tab.group) ?? ''
        made.folder(group, named || words.group, null)
      }
      made.tab({
        title: tab.title,
        url: tab.url,
        icon: null,
        pinned: tab.pinned,
        essential: tab.pinned,
        folder: group,
        container: 0,
      })
    }
  }
}

const CUSTOM = 'custom_root'
const TRASH = 'trash'

function readBookmarks(
  files: ({ roots: Said; prefix: string } | null)[],
  made: Made,
  words: FolderWords,
) {
  const root = (key: string, name: string, node: Said, prefix: string) => {
    made.folder('bookmarks', words.bookmarks, null)
    const id = `bookmark:${key}`
    made.folder(id, name, 'bookmarks')
    walk(node, id, prefix, made, words, 0)
  }

  for (const [key, word] of ROOTS) {
    for (const file of files) {
      const node = file?.roots[key]
      if (file && isObject(node)) root(key, words[word], node, file.prefix)
    }
  }
  for (const file of files) {
    const custom = file?.roots[CUSTOM]
    if (!file || !isObject(custom)) continue
    for (const [key, node] of Object.entries(custom)) {
      if (key === TRASH || !isObject(node)) continue
      root(`${CUSTOM}:${key}`, text(node.name) ?? words.other, node, file.prefix)
    }
  }
}

const DEEPEST = 64

function walk(
  folder: Said,
  id: string,
  prefix: string,
  made: Made,
  words: FolderWords,
  depth: number,
) {
  if (depth > DEEPEST) return
  list(folder.children).forEach((node, at) => {
    if (node.type === 'url') {
      const url = text(node.url)
      if (!url) return
      made.tab({
        title: text(node.name) ?? url,
        url,
        icon: null,
        pinned: false,
        folder: id,
        container: 0,
        ...addedOf(node.date_added),
      })
    } else if (node.type === 'folder') {
      const inner = `bookmark:${prefix}${text(node.guid) ?? text(node.id) ?? `${id}/${String(at)}`}`
      made.folder(inner, text(node.name) ?? words.other, id)
      walk(node, inner, prefix, made, words, depth + 1)
    }
  })
}

const EPOCH_GAP = 11_644_473_600_000_000n

function addedOf(value: unknown): { added?: Date } {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return {}
  const micro = BigInt(value) - EPOCH_GAP
  if (micro <= 0n) return {}
  const when = new Date(Number(micro / 1000n))
  return Number.isNaN(when.getTime()) ? {} : { added: when }
}
