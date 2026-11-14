import { foldName } from '@orden/markdown/links'
import { nameOf, samePath, joinPath, shownName } from '../../platform/src/api'
import type { Candidate } from '../../palette/rank'
import { ranked } from '../../palette/rank'
import { shownAddress } from '@orden/scan/visits'

export interface WebNote {
  path: string
  title: string
  url: string
  shown: string
}

type Websites = ReadonlyMap<string, { address: string | null }>

const WEB_NOTES = 4

export const noteKey = (path: string) => `note:${path}`

function readable(url: string): string {
  try {
    return shownAddress(url)
  } catch {
    return url
  }
}

const hostOf = (shown: string) => shown.split('/')[0] ?? shown

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

export function webNotesFor(
  typed: string,
  candidates: readonly Candidate<WebNote>[],
  most = WEB_NOTES,
): WebNote[] {
  if (!typed.trim()) return []
  return ranked(typed, candidates, most)
}

export function leads(note: WebNote, typed: string, used: boolean): boolean {
  const asked = foldName(typed.trim())
  if (!asked) return false
  return (
    used || foldName(note.title).startsWith(asked) || foldName(hostOf(note.shown)).startsWith(asked)
  )
}

export interface Opening {
  readonly tabs: readonly { id: string; path: string | null }[]
  activate(id: string): void
  close(id: string, reopenable?: boolean): void
  isNewTab(tab: { id: string }): boolean
  chosenOn(tabId: string): void
  openEntry(path: string, how?: { activate?: boolean }): Promise<void>
}

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
