import type { EditorView } from '@orden/editor'
import { insideOnly, insideSpace, nameOf, notePath } from '../../../platform/src/api'
import type { Change, Edit } from '@orden/scan/search/replace'
import type { NoteDoc } from '../../../workspace/documents.svelte'
import type { Keeping } from '../../../workspace/note-text'
import { DocError } from './problem'

export interface Space {
  id: string
  name: string
  root: string
}

export interface Desk {
  readonly spaces: readonly Space[]
  readonly activeSpace: Space | null
  documentAt(path: string): NoteDoc | null
  noteText(path: string): Promise<string | null>
  replaceInNotes(changes: readonly Change[], keeping?: Keeping): Promise<number>
  frontView(note: NoteDoc): EditorView | null
  linksOf(path: string): unknown[]
  backlinksOf(path: string): unknown[]
  metaOf?(path: string): Readonly<Record<string, string>> | null
  snapshot(path: string, content: string, source: string): Promise<void>
  draftIn(tab: string): NoteDoc | null
  padText(): Promise<string>
  padWrite(before: string, edits: readonly Edit[]): Promise<boolean>
  scheme(): 'dark' | 'light'
  agentsMay(path: string): boolean
}

export const SCRATCHPAD_TAB = 'scratchpad'

export const TYPING = 2000

export interface NoteAt {
  path: string
  space?: string
  tab?: string
  pad?: string
}

export interface Located {
  space: Space
  relative: string
  path: string
  draft?: NoteDoc
  pad?: true
}

function spaceOf(desk: Desk, named: string | undefined): Space {
  if (!named?.trim()) {
    const open = desk.activeSpace
    if (!open) throw new DocError('no_such_space', named, 'there is no space open')
    return open
  }

  const folded = named.trim().toLowerCase()
  const found = desk.spaces.find((one) => one.id === named || one.name.toLowerCase() === folded)
  if (!found) throw new DocError('no_such_space', named, `there is no space called ${named}`)
  return found
}

export function located(desk: Desk, at: NoteAt): Located {
  const space = spaceOf(desk, at.space)

  if (at.tab === SCRATCHPAD_TAB) {
    if (!at.pad) throw new DocError('no_such_note', at.tab, 'there is no scratchpad here')
    return { space, relative: nameOf(at.pad), path: at.pad, pad: true }
  }

  if (at.tab !== undefined) {
    const draft = desk.draftIn(at.tab)
    if (!draft) throw new DocError('no_such_note', at.tab, `tab ${at.tab} holds no unsaved note`)
    return { space, relative: '', path: `unsaved:${draft.key}`, draft }
  }

  const judged = insideOnly(at.path)
  if (judged === null) {
    throw new DocError('no_such_note', at.path, `${at.path} is not a path inside the space`)
  }

  const relative = notePath(judged)
  if (relative === null) {
    throw new DocError('not_a_note', at.path, `${judged} is not a markdown note`)
  }

  return { space, relative, path: insideSpace(space.root, relative) }
}

export function reachable(desk: Desk, at: NoteAt): Located {
  const note = located(desk, at)
  if (note.draft || note.pad || desk.agentsMay(note.path)) return note
  throw new DocError(
    'protected',
    note.relative,
    `${note.relative} is protected: the reader has to unlock it and choose Let agents read in its menu`,
  )
}

export function openNote(desk: Desk, note: Located): NoteDoc | null {
  if (note.draft) return note.draft
  if (note.pad) return null
  const open = desk.documentAt(note.path)
  return open?.kind === 'note' ? open : null
}

export async function wordsOf(desk: Desk, note: Located): Promise<string> {
  const text = note.draft
    ? note.draft.latest
    : note.pad
      ? await desk.padText()
      : await desk.noteText(note.path)
  if (text === null)
    throw new DocError('no_such_note', note.relative, `there is no note at ${note.relative}`)

  return text.replace(/\r\n?/g, '\n')
}
