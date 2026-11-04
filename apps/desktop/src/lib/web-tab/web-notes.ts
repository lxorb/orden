/** The space's own websites, offered by the address field beside the history (#1059):
 *  a saved web note found by a few letters of its name or its address, the way the
 *  palette finds it.
 *
 *  **One search, the palette's.** The candidates are rank.ts's, folded the way kinds.ts
 *  folds a page - the name in full, the site's host as another name, the whole address
 *  as something it is found by - and ranked by the same `ranked`, so a typo, words out
 *  of order and the letters of a name spread through it find a web note here exactly
 *  as they find it after Shift Shift, and how often it was reached for there lifts it
 *  here too.
 *
 *  **An index, not a walk per keystroke.** The candidates are built once for each map
 *  of websites the link index holds - a new map whenever a website changes - and only
 *  ranked as somebody types. */

import { foldName } from '@orden/markdown/links'
import { nameOf, samePath } from '../space-paths'
import { joinPath } from '../tauri'
import { shownName } from '../note-name'
import type { Candidate } from '../palette/rank'
import { ranked } from '../palette/rank'
import { shownAddress } from './omnibox'

/** One website of the space. */
export interface WebNote {
  /** Where the file is, as the app holds a path. */
  path: string
  /** What it is called: its file's name, as every list shows it. */
  title: string
  url: string
  /** How its address reads in a list. */
  shown: string
}

/** What the link index holds about one website; see `websitesHere`. */
type Websites = ReadonlyMap<string, { address: string | null }>

/** How many web notes the list offers at most, beside the history's pages. */
export const WEB_NOTES = 4

/** The key frecency.ts counts a note's uses under, which is the palette's. */
export const noteKey = (path: string) => `note:${path}`

function readable(url: string): string {
  try {
    return shownAddress(url)
  } catch {
    // Not an address `URL` reads: shown as written.
    return url
  }
}

/** The site's host of an address as a list shows it. */
const hostOf = (shown: string) => shown.split('/')[0] ?? shown

/** The candidates for one space's websites, ready to be ranked. Pure: the uses are
 *  handed in. */
export function webNoteCandidates(
  websites: Websites,
  root: string,
  worth: (key: string) => number,
): Candidate<WebNote>[] {
  const out: Candidate<WebNote>[] = []
  for (const [relative, { address }] of websites) {
    if (!address) continue

    const path = joinPath(root, relative)
    const title = shownName(nameOf(relative))
    const shown = readable(address)
    const key = noteKey(path)
    out.push({
      key,
      // A page by kind: a website is a place on the web, and one found only weakly
      // is not offered unless it has been used.
      kind: 'page',
      name: foldName(title),
      names: [foldName(hostOf(shown))],
      also: [foldName(shown)],
      lift: 0,
      use: worth(key),
      item: { path, title, url: address, shown },
    })
  }
  return out
}

const built = new WeakMap<Websites, { root: string; candidates: Candidate<WebNote>[] }>()

/** The candidates for the map the index holds now, built the first time it is asked
 *  for. */
export function webNotesOf(
  websites: Websites,
  root: string,
  worth: (key: string) => number,
): Candidate<WebNote>[] {
  const kept = built.get(websites)
  if (kept?.root === root) return kept.candidates

  const candidates = webNoteCandidates(websites, root, worth)
  built.set(websites, { root, candidates })
  return candidates
}

/** The web notes worth offering for what was typed, best first. Nothing for nothing
 *  typed: the list under an empty field is no list. */
export function webNotesFor(
  typed: string,
  candidates: readonly Candidate<WebNote>[],
  most = WEB_NOTES,
): WebNote[] {
  if (!typed.trim()) return []
  return ranked(typed, candidates, most)
}

/** Whether a web note is found strongly enough to stand above the history: its name or
 *  its site starts with what was typed, or it has been used. A note found by letters
 *  spread through it goes under the pages, so the top of the list still agrees with
 *  the address the field has just finished the word to. Pure. */
export function leads(note: WebNote, typed: string, used: boolean): boolean {
  const asked = foldName(typed.trim())
  if (!asked) return false
  return (
    used || foldName(note.title).startsWith(asked) || foldName(hostOf(note.shown)).startsWith(asked)
  )
}

/** What opening a web note needs of the store. */
export interface Opening {
  readonly tabs: readonly { id: string; path: string | null }[]
  activate(id: string): void
  close(id: string, reopenable?: boolean): void
  isNewTab(tab: { id: string }): boolean
  chosenOn(tabId: string): void
  openEntry(path: string, how?: { activate?: boolean }): Promise<void>
}

/** A web note chosen in a tab's address field: switched to where it is open already,
 *  and otherwise opened. From a new tab, the note takes that tab's place, as a kind
 *  chosen under it does; and a new tab left behind by a switch to another goes, the way
 *  Chrome's Switch to this tab closes the new tab it was chosen in. */
export async function openWebNote(ws: Opening, from: { id: string }, path: string): Promise<void> {
  const fresh = ws.isNewTab(from)
  const open = ws.tabs.find((one) => one.path !== null && samePath(one.path, path))
  if (open) {
    ws.activate(open.id)
    if (fresh && open.id !== from.id) ws.close(from.id, false)
    return
  }

  if (fresh) ws.chosenOn(from.id)
  await ws.openEntry(path, { activate: true })
}
