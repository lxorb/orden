import { documentOf } from '@orden/editor'
import { links } from '../../link-index.svelte'
import { protection } from '../../protect/protection.svelte'
import { isScratchpad } from '../../scratchpad/is.svelte'
import { scratchpad } from '../../scratchpad/pad'
import { withinSpace } from '../../space-paths'
import { invoke } from '../../tauri'
import { theme } from '../../theme/src/api'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import { isDraft } from '../../workspace/drafts'
import { keepVersion } from '../../workspace/in-turn'
import { type Desk, located, type NoteAt, SCRATCHPAD_TAB } from './desk'
import {
  editNote,
  type NoteEdited,
  putBackAt,
  undoAgent,
  undoAt,
  tracksCame,
  tracksMoved,
  tracksRemoved,
  undoSomeAt,
  writeNote,
} from './edit'
import type { Agent } from './presence'
import { type NoteRead, readNote } from './read'

export type { Agent } from './presence'
export type { NoteRead } from './read'
export { DocError } from './problem'
export { onTracks, trackedAgents, tracksAside, tracksOf } from './edit'

workspace.fileOps.follow((op) => {
  if (op.op === 'moved') tracksMoved(op.from, op.to, op.root ?? undefined)
  if (op.op === 'removed') tracksRemoved(op.path)
  if (op.op !== 'created') return undefined
  if (op.key) tracksMoved(`unsaved:${op.key}`, op.path)
  return tracksCame(
    op.path,
    (path) => invoke<string>('read_note', { path }).catch(() => null),
    op.putBack === true,
  )
})

export interface NoteDocs {
  readNote(at: NoteAt, include?: unknown): Promise<NoteRead>
  editNote(agent: Agent, at: NoteAt, edits: unknown, ifRev?: string): Promise<NoteEdited>
  writeNote(agent: Agent, at: NoteAt, text: string, ifRev?: string): Promise<NoteEdited>
  undoAgent(agent: Agent, at: NoteAt): Promise<{ undone: number }>
}

const desk: Desk = {
  get spaces() {
    return workspace.spaces
  },
  get activeSpace() {
    return workspace.activeSpace
  },
  documentAt: (path) => workspace.documentAt(path),
  noteText: (path) => workspace.noteText(path),
  replaceInNotes: (changes, keeping) => workspace.replaceInNotes(changes, keeping),
  frontView(note) {
    const tab = workspace.active
    if (tab?.note !== note) return null

    const view = views.of(tab.paneId)
    return view && documentOf(view) === note.live ? view : null
  },
  linksOf: (path) => links.outgoing(path),
  backlinksOf: (path) => links.backlinks(path),
  metaOf: (path) => workspace.itemMeta.of(path),
  snapshot: (path, content, source) => keepVersion(path, content, source),
  draftIn(id) {
    const tab = workspace.tabs.find((one) => one.id === id)
    return tab?.kind === 'note' && isDraft(tab.note) ? tab.note : null
  },
  padText: () => scratchpad.text(),
  padWrite: (before, edits) => scratchpad.replace(before, edits),
  scheme: () => theme.current,
  agentsMay: (path) => protection.agentsMay(path),
}

async function padded(at: NoteAt): Promise<NoteAt> {
  return at.tab === SCRATCHPAD_TAB ? { ...at, pad: await scratchpad.where() } : at
}

export const notes: NoteDocs = {
  readNote: async (at, include) => readNote(desk, await padded(at), include),
  editNote: async (agent, at, edits, ifRev) =>
    editNote(desk, agent, await padded(at), edits, ifRev),
  writeNote: async (agent, at, text, ifRev) =>
    writeNote(desk, agent, await padded(at), text, ifRev),
  undoAgent: async (agent, at) => undoAgent(desk, agent, await padded(at)),
}

export async function undoAgentIn(agent: Agent, path: string): Promise<{ undone: number }> {
  const note = locatedAt(path)
  return note ? undoAt(desk, agent, note) : { undone: 0 }
}

function locatedAt(path: string) {
  if (isScratchpad(path)) return located(desk, { path: '', tab: SCRATCHPAD_TAB, pad: path })
  if (path.startsWith('unsaved:')) {
    const key = path.slice('unsaved:'.length)
    const tab = workspace.tabs.find((one) => one.kind === 'note' && one.note.key === key)
    return tab ? located(desk, { path: '', tab: tab.id }) : null
  }
  for (const space of workspace.spaces) {
    const relative = withinSpace(space.root, path)
    if (relative !== null) return located(desk, { path: relative, space: space.id })
  }
  return null
}

export async function undoSomeIn(
  agent: Agent,
  path: string,
  ids: ReadonlySet<string>,
  token?: string,
): Promise<string[]> {
  const note = locatedAt(path)
  return note ? undoSomeAt(desk, agent, note, ids, token) : []
}

export async function putBackIn(agent: Agent, path: string, token: string): Promise<string[]> {
  const note = locatedAt(path)
  return note ? putBackAt(desk, agent, note, token) : []
}
