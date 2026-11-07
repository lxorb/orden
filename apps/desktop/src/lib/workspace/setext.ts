import type { Query } from '@orden/scan/search/query'
import type { ItemMeta, MetaPatch } from '@orden/sync-core/meta'
import type { Change } from '../search/apply'
import { changeOf } from '../search/replace'
import { relativeTo, samePath } from '../space-paths'
import { keepJson, stored } from '../stored'
import { type HoldsNotes, noteText, replaceInNotes } from './note-text'

export const SETEXT_GONE = 'nib:setext-gone'

export const SETEXT_KEY = 'setext'

const REWRITTEN = 'gone'

const AFTER_THE_LAUNCH = 30_000

const UNDERLINED: Query = {
  kind: 'regex',
  source: '\\S[ \\t]*\\r?\\n[ \\t>]*(?:[-*+]|\\d+[.)])?[ \\t]*(?:=+|-+)[ \\t]*(?:\\r?\\n|$)',
  fold: false,
}

const MOST_UNDERLINED = 100_000

export interface MarksNotes {
  readonly itemMeta: {
    describes(root: string): boolean
    fromEngine(root: string): Promise<void>
    itemsOf(root: string): Readonly<Record<string, ItemMeta>>
    setMany(root: string, patches: Readonly<Record<string, MetaPatch>>): void
  }
}

function spacesDone(): string[] {
  const said = stored(SETEXT_GONE)
  return Array.isArray(said) ? said.filter((one): one is string => typeof one === 'string') : []
}

function markDone(root: string) {
  keepJson(SETEXT_GONE, [...spacesDone(), root])
}

function beingWritten(ws: HoldsNotes, path: string): boolean {
  const open = ws.documentAt(path)
  return open !== null && (open.dirty || open.revision > 0 || open.shared !== null)
}

async function readable(root: string): Promise<((path: string) => boolean) | null> {
  const { keptAway } = await import('../web/away.svelte')
  if (!keptAway.under(root).length) return () => true
  const underlined = new Set<string>()
  const whole = await keptAway.search(root, UNDERLINED, [], MOST_UNDERLINED, (found) => {
    for (const hit of found.hits) {
      const away = keptAway.at(hit.path)
      if (away) underlined.add(away.id)
    }
  })
  if (!whole) return null
  return (path) => {
    const away = keptAway.at(path)
    return away === null || underlined.has(away.id)
  }
}

function rewrittenBefore(ws: MarksNotes, root: string): boolean {
  return Object.values(ws.itemMeta.itemsOf(root)).some((meta) => SETEXT_KEY in meta)
}

export async function dropSetext(
  ws: HoldsNotes & MarksNotes,
  root: string,
  signedIn: () => boolean,
  waits = AFTER_THE_LAUNCH,
): Promise<number> {
  if (spacesDone().some((one) => samePath(one, root))) return 0

  await new Promise((go) => setTimeout(go, waits))
  if (!samePath(ws.activeSpace?.root, root)) return 0

  if (signedIn()) {
    if (!ws.itemMeta.describes(root)) return 0
    await ws.itemMeta.fromEngine(root)
  }
  if (rewrittenBefore(ws, root)) {
    markDone(root)
    return 0
  }

  const reads = await readable(root)
  if (!reads) return 0

  const { setextEdits } = await import('@orden/editor/setext')
  const changes: Change[] = []
  let first: string | null = null

  for (const note of ws.notes) {
    if (!samePath(ws.activeSpace?.root, root)) return 0

    if (beingWritten(ws, note.path)) continue
    if (!reads(note.path)) {
      first ??= note.path
      continue
    }
    const before = await noteText(ws, note.path)
    if (before === null) continue
    first ??= note.path

    const edits = setextEdits(before)
    if (edits.length) changes.push(changeOf(note.path, before, edits))
  }

  if (rewrittenBefore(ws, root)) {
    markDone(root)
    return 0
  }
  const untouched = changes.filter((change) => !beingWritten(ws, change.path))
  const written = untouched.length ? await replaceInNotes(ws, untouched, { undoable: false }) : 0
  const marked = untouched.length ? untouched.map((change) => change.path) : first ? [first] : []
  if (marked.length) {
    ws.itemMeta.setMany(
      root,
      Object.fromEntries(
        marked.map((path) => [relativeTo(root, path), { [SETEXT_KEY]: REWRITTEN }]),
      ),
    )
  }
  markDone(root)
  return written
}

export function keepSetextMarked(ws: HoldsNotes & MarksNotes, root: string): void {
  if (!spacesDone().some((one) => samePath(one, root))) return
  if (!samePath(ws.activeSpace?.root, root) || !ws.itemMeta.describes(root)) return
  if (rewrittenBefore(ws, root)) return
  const first = ws.notes[0]
  if (!first) return
  ws.itemMeta.setMany(root, { [relativeTo(root, first.path)]: { [SETEXT_KEY]: REWRITTEN } })
}
