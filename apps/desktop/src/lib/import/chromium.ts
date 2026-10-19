/** What Chrome, Edge, Brave, Chromium and Vivaldi say of a profile, read into a
 *  browser's sidebar (sidebar.ts): its open tabs, the pinned ones, its tab groups and
 *  its bookmarks. All five are Chromium and keep the same files.
 *
 *  A profile is one space. Its open windows are its session (snss.ts), every ordinary
 *  window's tabs in their order:
 *
 *  - **A pinned tab** is one of the Essentials, as Firefox's are.
 *  - **A tab group** is a folder of its name where its first tab is; one nobody named
 *    is called Tab group, and its colour has nothing to become.
 *  - **The bookmarks** are `Bookmarks`, a JSON file of three roots - the bar, the other
 *    bookmarks and the phone's - and they come as Firefox's do: a folder called
 *    Bookmarks after everything else, a folder for each root that holds any, every
 *    folder in them a folder and each bookmark a web note kept on the day it was made.
 *
 *  A group closed and saved is kept in the profile's sync database rather than in its
 *  session, and does not come. A session written encrypted cannot be read at all, and
 *  the profile then brings its bookmarks alone; browser-landing.ts says so. Only pages
 *  on the web, and no folder with none of them in it.
 *
 *  Pure: the session and the bookmarks as they were read in, the sidebar out. */

import type { Sidebar } from './sidebar'
import { type FolderWords, isObject, list, Made, type Said, text } from './sidebar-made'
import type { SnssSession } from './snss'

/** Chromium's roots, by their keys, in the order its bookmark manager shows them. */
const ROOTS: [string, keyof FolderWords][] = [
  ['bookmark_bar', 'bar'],
  ['other', 'other'],
  ['synced', 'mobile'],
]

/** A profile as one space named `name`: its open tabs and groups, then its bookmarks.
 *  Either may be null, for a file that was not there or did not read. */
export function chromiumSidebar(
  session: SnssSession | null,
  bookmarks: unknown,
  name: string,
  words: FolderWords,
): Sidebar {
  const made = new Made()
  if (session) readWindows(session, made, words)
  if (isObject(bookmarks) && isObject(bookmarks.roots)) readBookmarks(bookmarks.roots, made, words)
  return made.sidebar(name)
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

/** Each root that holds a bookmark a folder in Bookmarks, under the reader's name for
 *  it: Chromium writes its roots' names in English whatever language it is in. */
function readBookmarks(roots: Said, made: Made, words: FolderWords) {
  for (const [key, word] of ROOTS) {
    const root = roots[key]
    if (!isObject(root)) continue
    made.folder('bookmarks', words.bookmarks, null)
    const id = `bookmark:${key}`
    made.folder(id, words[word], 'bookmarks')
    walk(root, id, made, words, 0)
  }
}

/** Deeper than anybody nests, and a stop for a tree that goes round. */
const DEEPEST = 64

function walk(folder: Said, id: string, made: Made, words: FolderWords, depth: number) {
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
      const inner = `bookmark:${text(node.guid) ?? text(node.id) ?? `${id}/${String(at)}`}`
      made.folder(inner, text(node.name) ?? words.other, id)
      walk(node, inner, made, words, depth + 1)
    }
  })
}

/** Microseconds from 1601 to 1970, which is where Chromium counts a bookmark's day from. */
const EPOCH_GAP = 11_644_473_600_000_000n

/** When a bookmark was made: a string of microseconds since 1601. */
function addedOf(value: unknown): { added?: Date } {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return {}
  const micro = BigInt(value) - EPOCH_GAP
  if (micro <= 0n) return {}
  const when = new Date(Number(micro / 1000n))
  return Number.isNaN(when.getTime()) ? {} : { added: when }
}
