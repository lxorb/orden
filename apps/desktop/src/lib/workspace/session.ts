/** The session as it is written down between runs: which spaces there are,
 *  which notes were open, and where each was being read.
 *
 *  Reading it is the interesting half. Storage is not a type system - the entry
 *  may have been written by an older version of the app, or cut short by a full
 *  disk - so nothing here casts. Each field is recognised on its own, and one
 *  that is not recognised is simply absent, which lets an entry bring back the
 *  notes it does hold rather than none of them. */

import { isNumber, isRecord, isString, stringList } from '../stored'
import type { Panel, Space } from '../workspace.svelte'

/** One tab as it is written down: enough to put it back exactly, including
 *  work that never reached the disk. */
export interface Draft {
  path: string | null
  name: string
  doc: string
  dirty: boolean
  cursor: number
  scroll: number
  anchor?: number | undefined
}

/** Where a note was last looked at on this device. Kept after its tab has
 *  closed, so the note opens there again rather than at the top. */
export interface Position {
  cursor: number
  scroll: number
  anchor?: number | undefined
  at: number
}

export interface Session {
  spaces: Space[]
  activeSpace: string | null
  tabs?: Draft[]
  positions?: Record<string, Position>
  /** Index into `tabs`, not an id: ids are handed out fresh on every run. */
  active?: number
  /** Written by versions before drafts existed. Still read, so an update
   *  arrives with the same notes open. */
  openPaths?: string[]
  activePath?: string | null
  panel: Panel | null
}

const PANELS: readonly Panel[] = ['tree', 'outline', 'search']

function isPanel(value: unknown): value is Panel {
  return PANELS.some((panel) => panel === value)
}

function isSpace(value: unknown): value is Space {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.root)
}

/** One tab, once it reads as one. A draft with no name or no text is not half
 *  a note; it is a corrupt entry. */
export function readDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null

  const { path, name, doc, dirty, cursor, scroll, anchor } = value
  if (typeof name !== 'string' || typeof doc !== 'string') return null
  if (path !== null && typeof path !== 'string') return null

  return {
    path,
    name,
    doc,
    dirty: dirty === true,
    cursor: isNumber(cursor) ? cursor : 0,
    scroll: isNumber(scroll) ? scroll : 0,
    ...(isNumber(anchor) ? { anchor } : {}),
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
export function readPositions(value: unknown): Record<string, Position> {
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

  const drafts = Array.isArray(value.tabs)
    ? value.tabs.map(readDraft).filter((draft): draft is Draft => draft !== null)
    : null
  const openPaths = stringList(value.openPaths)

  return {
    spaces: Array.isArray(value.spaces) ? value.spaces.filter(isSpace) : [],
    activeSpace: isString(value.activeSpace) ? value.activeSpace : null,
    panel: isPanel(value.panel) ? value.panel : null,
    positions: readPositions(value.positions),
    ...(drafts ? { tabs: drafts } : {}),
    ...(isNumber(value.active) ? { active: value.active } : {}),
    ...(openPaths ? { openPaths } : {}),
    ...(isString(value.activePath) ? { activePath: value.activePath } : {}),
  }
}

/** Writes the session down, giving things up until it fits.
 *
 *  Storage is finite. Unsaved work is what has to survive a full one, so the
 *  notes that live somewhere else give up their copies first - the caller
 *  already leaves out the saved ones - and if that still does not fit, the
 *  edited ones that have a file give up theirs too. The file is an older
 *  version of the same note, which is a far better place to come back to than
 *  none. A note that has never been saved exists nowhere but here, so its
 *  words are the last thing to go.
 *
 *  Answers whether anything was written at all. */
export function writeSession(key: string, state: Session): boolean {
  if (put(key, state)) return true

  const lean = state.tabs?.map((draft) =>
    draft.path && draft.doc ? { ...draft, doc: '', dirty: false } : draft,
  )

  return put(key, { ...state, ...(lean ? { tabs: lean } : {}) })
}

function put(key: string, state: Session): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    // Out of room, or a browser that allows no site data at all. Either way
    // the entry already there stays, which is a better place to come back to
    // than none.
    return false
  }
}
