import {
  agentsOf,
  documentOf,
  EditorState,
  type EditorView,
  remoteCarets,
  undoEdit,
} from '@orden/editor'
import { applied, type Change } from '@orden/scan/search/replace'
import { NoteDoc } from '../../../workspace/documents.svelte'
import type { Keeping } from '../../../workspace/note-text'
import type { Desk, Space } from './desk'

const SPACE: Space = { id: 's1', name: 'Space', root: '/space' }

export class Pane {
  state: EditorState

  constructor(
    readonly note: NoteDoc,
    caret = 0,
  ) {
    this.state = EditorState.create({
      doc: note.live.text,
      selection: { anchor: caret },
      extensions: [remoteCarets()],
    })
    note.live.join(this)
  }

  dispatch(spec: Parameters<EditorState['update']>[0]) {
    this.state = this.state.update(spec).state
  }

  get text(): string {
    return this.state.doc.toString()
  }

  get caret(): number {
    return this.state.selection.main.head
  }

  type(at: number, insert: string) {
    this.change({ from: at, insert }, at + insert.length)
  }

  erase(from: number, to: number) {
    this.change({ from, to }, from)
  }

  select(from: number, to: number) {
    this.state = this.state.update({ selection: { anchor: from, head: to } }).state
  }

  undo(): boolean {
    return undoEdit(this as unknown as EditorView)
  }

  get agents() {
    return agentsOf(this.state)
  }

  private change(changes: { from: number; to?: number; insert?: string }, caret: number) {
    const made = this.state.update({ changes, selection: { anchor: caret } })
    this.state = made.state
    documentOf(this)?.local(made.changes, made.state.selection, this)
  }
}

export function deskWith(notes: Record<string, string>, open: readonly string[] = []) {
  const disk = new Map(Object.entries(notes).map(([path, text]) => [`${SPACE.root}/${path}`, text]))
  const documents = new Map<string, NoteDoc>()
  const drafts = new Map<string, NoteDoc>()
  const written: { changes: readonly Change[]; keeping: Keeping | undefined }[] = []
  const kept: { path: string; content: string; source: string }[] = []
  let front: Pane | null = null
  const pad = { text: '', wrote: 0 }
  const refusing = { next: false }
  const shut = new Set<string>()

  const opened = (path: string, caret = 0): Pane => {
    const at = `${SPACE.root}/${path}`
    const note = new NoteDoc(
      { kind: 'note', path: at, name: path, text: disk.get(at) ?? '', dirty: false },
      () => undefined,
    )
    documents.set(at, note)
    return new Pane(note, caret)
  }

  const panes = Object.fromEntries(open.map((path) => [path, opened(path)]))

  const desk: Desk = {
    spaces: [SPACE],
    activeSpace: SPACE,
    documentAt: (path) => documents.get(path) ?? null,
    noteText: (path) => {
      const note = documents.get(path)
      if (note) {
        note.flush()
        return Promise.resolve(note.text)
      }
      return Promise.resolve(disk.get(path) ?? null)
    },
    replaceInNotes: (changes, keeping) => {
      if (refusing.next) {
        refusing.next = false
        return Promise.resolve(0)
      }
      written.push({ changes, keeping })
      for (const change of changes) disk.set(change.path, change.after)
      return Promise.resolve(changes.length)
    },
    frontView: (note) => (front?.note === note ? (front as unknown as EditorView) : null),
    linksOf: () => [],
    backlinksOf: () => [],
    snapshot: (path, content, source) => {
      kept.push({ path, content, source })
      return Promise.resolve()
    },
    scheme: () => 'dark',
    agentsMay: (path) => !shut.has(path),
    draftIn: (tab) => drafts.get(tab) ?? null,
    padText: () => Promise.resolve(pad.text),
    padWrite: (before, edits) => {
      if (pad.text !== before) return Promise.resolve(false)
      pad.text = applied(before, edits)
      pad.wrote++
      return Promise.resolve(true)
    },
  }

  return {
    desk,
    panes,
    disk,
    written,
    kept,
    pad,
    refusing,
    shut: (path: string) => shut.add(`${SPACE.root}/${path}`),
    open: opened,
    draft: (tab: string, text: string): Pane => {
      const note = new NoteDoc(
        { kind: 'note', path: null, name: 'Untitled', text, dirty: false },
        () => undefined,
      )
      drafts.set(tab, note)
      return new Pane(note, 0)
    },
    close: (path: string) => {
      const at = `${SPACE.root}/${path}`
      const note = documents.get(at)
      if (note) disk.set(at, note.live.text.toString())
      documents.delete(at)
    },
    inFront: (pane: Pane | null) => {
      front = pane
    },
    fileOf: (path: string) => disk.get(`${SPACE.root}/${path}`),
  }
}
