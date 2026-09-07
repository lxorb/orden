/** The session as it is written down between runs: which spaces there are, how
 *  the panes were arranged, which notes were open in each, and where each was
 *  being read.
 *
 *  Reading it is the interesting half. Storage is not a type system - the entry
 *  may have been written by an older version of the app, or cut short by a full
 *  disk - so nothing here casts. Each field is recognised on its own, and one
 *  that is not recognised is simply absent, which lets an entry bring back the
 *  notes it does hold rather than none of them.
 *
 *  Three shapes have been written so far, and all three are still read: a list
 *  of paths, then one flat strip of tabs, and now a tree of panes with a strip
 *  in each. `version` says which; an entry with none is read by looking for the
 *  fields it does have. */

import { identifier } from '../identifier'
import { isNumber, isRecord, isString, stringList } from '../stored'
import type { Panel, Space } from '../workspace.svelte'
import type { TabKind } from './documents.svelte'
import { type Along, type Frame, pane } from './pane-tree'

/** The shape this version writes. */
const VERSION = 2

/** One tab as it is written down: enough to put it back exactly, including work
 *  that never reached the disk. */
export interface Draft {
  kind: TabKind
  path: string | null
  name: string
  doc: string
  dirty: boolean
  cursor: number
  scroll: number
  anchor?: number | undefined
  /** Which document this tab was a view of. Two panes showing the same note
   *  write the same key here, so a restart puts them back on one document rather
   *  than on two copies of it. Absent for a tab that had it to itself. */
  share?: string | undefined
  /** Whether the tab was showing the note as it reads. Absent for one that was
   *  being written in, which is what a tab is unless it says otherwise. */
  reading?: boolean | undefined
}

/** One pane: its strip of tabs, which of them was showing, and whether it was
 *  scrolling with the other pane on the same note. */
export interface PaneDraft {
  id: string
  tabs: Draft[]
  /** Index into `tabs`, not an id: ids are handed out fresh on every run. */
  active: number
  linked: boolean
}

export type FrameDraft =
  | { kind: 'pane'; pane: PaneDraft }
  | { kind: 'split'; id: string; along: Along; fraction: number; sides: [FrameDraft, FrameDraft] }

/** The arrangement, whole: the panes, what is in them, which one had the focus,
 *  and the sidebar. This is what the session is, and what a named layout holds a
 *  copy of; see layouts.svelte.ts. */
export interface Layout {
  frame: FrameDraft
  focused: string
  panel: Panel | null
}

export interface Position {
  cursor: number
  scroll: number
  anchor?: number | undefined
  at: number
}

export interface Session {
  spaces: Space[]
  activeSpace: string | null
  positions?: Record<string, Position>
  /** The panes and everything in them. Written by this version. */
  layout?: Layout
  /** One flat strip of tabs, and the index of the one showing. Written before
   *  there were panes; still read, so an update keeps the notes that were open. */
  tabs?: Draft[]
  active?: number
  /** Written before there were drafts. Still read, for the same reason. */
  openPaths?: string[]
  activePath?: string | null
  /** The sidebar, for entries written before it became part of the layout. */
  panel: Panel | null
}

const PANELS: readonly Panel[] = ['tree', 'outline', 'search', 'links']

function isPanel(value: unknown): value is Panel {
  return PANELS.some((panel) => panel === value)
}

const TAB_KINDS: readonly TabKind[] = ['note', 'graph']

/** Which kind of tab an entry says it is. An entry written before there were
 *  kinds, or one naming a kind this version has never heard of, is a note: that
 *  is what a tab with a path and some words in it can always be read as. */
function tabKind(value: unknown): TabKind {
  return TAB_KINDS.find((kind) => kind === value) ?? 'note'
}

function isSpace(value: unknown): value is Space {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.root)
}

/** One tab, once it reads as one. A draft with no name or no text is not half a
 *  note; it is a corrupt entry. */
export function readDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null

  const { kind, path, name, doc, dirty, cursor, scroll, anchor, share, reading } = value
  if (typeof name !== 'string' || typeof doc !== 'string') return null
  if (path !== null && typeof path !== 'string') return null

  return {
    kind: tabKind(kind),
    path,
    name,
    doc,
    dirty: dirty === true,
    cursor: isNumber(cursor) ? cursor : 0,
    scroll: isNumber(scroll) ? scroll : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
    ...(isString(share) ? { share } : {}),
    ...(reading === true ? { reading: true } : {}),
  }
}

function readDrafts(value: unknown): Draft[] {
  if (!Array.isArray(value)) return []
  return value.map(readDraft).filter((draft): draft is Draft => draft !== null)
}

function readPane(value: unknown): PaneDraft | null {
  if (!isRecord(value) || !isString(value.id)) return null

  return {
    id: value.id,
    tabs: readDrafts(value.tabs),
    active: isNumber(value.active) ? value.active : 0,
    linked: value.linked === true,
  }
}

const ALONG: readonly Along[] = ['row', 'column']

/** A pane, or a split of two of them. A split missing either side is read as
 *  whichever side it does have, so half an arrangement still opens the notes. */
function readFrame(value: unknown): FrameDraft | null {
  if (!isRecord(value)) return null

  if (value.kind === 'split') {
    const sides = Array.isArray(value.sides) ? value.sides.map(readFrame) : []
    const [first, second] = sides
    if (!first || !second) return first ?? second ?? null

    const along = ALONG.find((one) => one === value.along) ?? 'row'
    const fraction = isNumber(value.fraction) ? value.fraction : 0.5
    const id = isString(value.id) ? value.id : identifier()

    return { kind: 'split', id, along, fraction, sides: [first, second] }
  }

  const pane = readPane(value.pane)
  return pane ? { kind: 'pane', pane } : null
}

export function readLayout(value: unknown): Layout | null {
  if (!isRecord(value)) return null

  const frame = readFrame(value.frame)
  if (!frame) return null

  return {
    frame,
    focused: isString(value.focused) ? value.focused : '',
    panel: isPanel(value.panel) ? value.panel : null,
  }
}

export function readPosition(value: unknown): Position | null {
  if (!isRecord(value)) return null

  const { cursor, scroll, anchor, at } = value
  if (!isNumber(cursor) || !isNumber(scroll)) return null

  return {
    cursor,
    scroll,
    at: isNumber(at) ? at : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
  }
}

/** Where notes were last looked at, by path, dropping any entry that no longer
 *  reads as a place. One unreadable entry says nothing about the others. */
function readPositions(value: unknown): Record<string, Position> {
  if (!isRecord(value)) return {}

  const out: Record<string, Position> = {}
  for (const [path, one] of Object.entries(value)) {
    const place = readPosition(one)
    if (place) out[path] = place
  }

  return out
}

export function readSession(value: unknown): Session | null {
  if (!isRecord(value)) return null

  const layout = readLayout(value.layout)
  const drafts = Array.isArray(value.tabs) ? readDrafts(value.tabs) : null
  const openPaths = stringList(value.openPaths)

  return {
    spaces: Array.isArray(value.spaces) ? value.spaces.filter(isSpace) : [],
    activeSpace: isString(value.activeSpace) ? value.activeSpace : null,
    panel: layout?.panel ?? (isPanel(value.panel) ? value.panel : null),
    positions: readPositions(value.positions),
    ...(layout ? { layout } : {}),
    ...(drafts ? { tabs: drafts } : {}),
    ...(isNumber(value.active) ? { active: value.active } : {}),
    ...(openPaths ? { openPaths } : {}),
    ...(isString(value.activePath) ? { activePath: value.activePath } : {}),
  }
}

/** Every pane of an arrangement, in the order they were laid out. */
export function panesOf(frame: FrameDraft): PaneDraft[] {
  if (frame.kind === 'pane') return [frame.pane]
  return [...panesOf(frame.sides[0]), ...panesOf(frame.sides[1])]
}

/** The written shape as a tree the app can run on. `showing` says which of a
 *  pane's tabs is the one on show, by the id the tab was given on the way in. */
export function frameOf(draft: FrameDraft, showing: (pane: PaneDraft) => string | null): Frame {
  if (draft.kind === 'pane') {
    const one = pane(draft.pane.id, showing(draft.pane))
    one.linked = draft.pane.linked
    return one
  }

  return {
    kind: 'split',
    id: draft.id,
    along: draft.along,
    fraction: draft.fraction,
    sides: [frameOf(draft.sides[0], showing), frameOf(draft.sides[1], showing)],
  }
}

/** And the other way about: the tree as it is written down. `strip` hands over
 *  the tabs of a pane, already drafted, since only the workspace knows them. */
export function frameDraft(
  frame: Frame,
  strip: (pane: { id: string; activeTabId: string | null }) => { tabs: Draft[]; active: number },
): FrameDraft {
  if (frame.kind === 'pane') {
    const { tabs, active } = strip(frame)
    return { kind: 'pane', pane: { id: frame.id, tabs, active, linked: frame.linked } }
  }

  return {
    kind: 'split',
    id: frame.id,
    along: frame.along,
    fraction: frame.fraction,
    sides: [frameDraft(frame.sides[0], strip), frameDraft(frame.sides[1], strip)],
  }
}

/** The same arrangement with nobody's words in it, which is what a named layout
 *  keeps: it says which notes sit where, and the notes themselves are on disk.
 *  Also what the session falls back to when storage is full; see below. */
export function withoutText(layout: Layout): Layout {
  return { ...layout, frame: bareFrame(layout.frame) }
}

function bareFrame(frame: FrameDraft): FrameDraft {
  if (frame.kind === 'split') {
    return { ...frame, sides: [bareFrame(frame.sides[0]), bareFrame(frame.sides[1])] }
  }

  const tabs = frame.pane.tabs.map((draft) =>
    draft.path && draft.doc ? { ...draft, doc: '', dirty: false } : draft,
  )

  return { kind: 'pane', pane: { ...frame.pane, tabs } }
}

/** Writes the session down, giving things up until it fits.
 *
 *  Storage is finite. Unsaved work is what has to survive a full one, so the
 *  notes that live somewhere else give up their copies first - the caller
 *  already leaves out the saved ones - and if that still does not fit, the
 *  edited ones that have a file give up theirs too. The file is an older version
 *  of the same note, which is a far better place to come back to than none. A
 *  note that has never been saved exists nowhere but here, so its words are the
 *  last thing to go.
 *
 *  Answers whether anything was written at all. */
export function writeSession(key: string, state: Session): boolean {
  if (put(key, state)) return true

  const lean = state.layout ? withoutText(state.layout) : undefined
  return put(key, { ...state, ...(lean ? { layout: lean } : {}) })
}

function put(key: string, state: Session): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ version: VERSION, ...state }))
    return true
  } catch {
    // Out of room, or a browser that allows no site data at all. Either way the
    // entry already there stays, which is a better place to come back to than
    // none.
    return false
  }
}
