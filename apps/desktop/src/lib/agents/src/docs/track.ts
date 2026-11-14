import { ChangeSet, type Heard, type Mark, Text } from '@orden/editor'
import { fold } from '@orden/rooms/fold'
import type { NoteDoc } from '../../../workspace/documents.svelte'
import type { Replacement } from './edits'
import { Steps } from './steps'

let minted = 0

const AGENT_EVENT = 'agent'

const UNDO_EVENT = 'undo.agent'

function ropeOf(words: string): Text {
  return Text.of(words.split('\n'))
}

type ChangeDesc = ChangeSet['desc']

export interface Span {
  from: number
  to: number
  removed: string
  inserted: string
}

function spansOf(changes: ChangeSet, before: Text): Span[] {
  const spans: Span[] = []
  changes.iterChanges((fromA, toA, from, to, inserted) => {
    spans.push({ from, to, removed: before.sliceString(fromA, toA), inserted: inserted.toString() })
  })
  return spans
}

function spanThrough(span: Span, change: ChangeDesc): Span | null {
  const from = change.mapPos(span.from, 1)
  const to = Math.max(from, change.mapPos(span.to, -1))
  return to > from || span.removed ? { ...span, from, to } : null
}

function replacementsOf(changes: ChangeSet): Replacement[] {
  const edits: Replacement[] = []
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    edits.push({ from, to, insert: inserted.toString() })
  })
  return edits
}

export class Track {
  readonly steps = new Steps()
  private held: { note: NoteDoc; stop: () => void } | null = null
  private seen: string | null = null
  private making = false
  private said = 0
  private readonly where = new Map<string, Span[]>()
  private readonly when = new Map<string, number>()
  private readonly whose = new Map<string, string>()
  private readonly takenBack = new Map<string, { ids: string[]; changes: ChangeSet }>()

  constructor(
    private readonly prefix: string,
    private readonly told: (edits: number) => void,
  ) {}

  nextId(thread?: string): string {
    minted++
    const id = `${this.prefix}:${String(minted)}`
    if (thread) this.whose.set(id, thread)
    return id
  }

  catchUp(open: NoteDoc | null, words: string) {
    if (open && this.held?.note === open) return
    this.letGo()

    if (this.seen !== null && this.seen !== words) {
      const since = open?.live.since(this.seen) ?? null
      const span = since ? null : fold(this.seen, words)
      this.carry(since?.desc ?? ChangeSet.of(span ? [span] : [], this.seen.length).desc)
    }

    this.seen = words
    if (open) this.hold(open)
    this.tell()
  }

  applyOpen(note: NoteDoc, edits: readonly Replacement[], id: string): ChangeSet {
    this.catchUp(note, note.live.text.toString())
    const before = note.live.text

    const changes = this.quietly(() =>
      note.live.edit(edits, { userEvent: AGENT_EVENT, marks: [{ id, undone: false }] }),
    )
    this.recorded(id, changes, before)
    return changes
  }

  recordClosed(before: string, edits: readonly Replacement[], after: string, id: string) {
    this.seen = after
    this.recorded(id, ChangeSet.of(edits, before.length), ropeOf(before))
  }

  follow(open: NoteDoc) {
    if (this.held?.note !== open) this.catchUp(open, open.live.text.toString())
  }

  get ids(): string[] {
    return this.steps.ids
  }

  spansOf(id: string): readonly Span[] {
    return this.where.get(id) ?? []
  }

  madeAt(id: string): number {
    return this.when.get(id) ?? 0
  }

  threadOf(id: string): string | null {
    return this.whose.get(id) ?? null
  }

  undoSomeOpen(note: NoteDoc, ids: ReadonlySet<string>, token?: string): string[] {
    this.catchUp(note, note.live.text.toString())
    const before = note.live.text
    const some = this.steps.take(ids, before)
    if (!some?.ids.length) return []

    const marks: Mark[] = some.ids.map((id) => ({ id, undone: true }))
    const changes = this.quietly(() =>
      note.live.edit(some.changes, { userEvent: UNDO_EVENT, marks }),
    )
    this.tookBack(some.ids, changes, before, token)
    return some.ids
  }

  private saved(): () => void {
    const steps = this.steps.saved()
    const seen = this.seen
    const where = [...this.where]
    const takenBack = [...this.takenBack]
    return () => {
      steps()
      this.letGo()
      this.seen = seen
      this.where.clear()
      for (const [id, spans] of where) this.where.set(id, spans)
      this.takenBack.clear()
      for (const [name, back] of takenBack) this.takenBack.set(name, back)
      this.tell()
    }
  }

  undoSomeClosed(
    words: string,
    ids: ReadonlySet<string>,
    token?: string,
  ): { edits: Replacement[]; after: string; ids: string[]; refused: () => void } | null {
    this.catchUp(null, words)
    const refused = this.saved()
    const before = ropeOf(words)
    const some = this.steps.take(ids, before)
    if (!some?.ids.length) return null

    const after = some.changes.apply(before).toString()
    this.seen = after
    this.tookBack(some.ids, some.changes, before, token)
    return { edits: replacementsOf(some.changes), after, ids: some.ids, refused }
  }

  putBackOpen(note: NoteDoc, token: string): string[] {
    this.catchUp(note, note.live.text.toString())
    const back = this.takenBack.get(token)
    if (!back) return []
    this.takenBack.delete(token)

    const before = note.live.text
    const marks: Mark[] = back.ids.map((id) => ({ id, undone: false }))
    const changes = this.quietly(() =>
      note.live.edit(back.changes, { userEvent: AGENT_EVENT, marks }),
    )
    this.recorded(back.ids, changes, before)
    return back.ids
  }

  putBackClosed(
    words: string,
    token: string,
  ): { edits: Replacement[]; after: string; ids: string[]; refused: () => void } | null {
    this.catchUp(null, words)
    const refused = this.saved()
    const back = this.takenBack.get(token)
    if (!back) return null
    this.takenBack.delete(token)

    const before = ropeOf(words)
    const after = back.changes.apply(before).toString()
    this.seen = after
    this.recorded(back.ids, back.changes, before)
    return { edits: replacementsOf(back.changes), after, ids: back.ids, refused }
  }

  holds(token: string): boolean {
    return this.takenBack.has(token)
  }

  forgetTaken(token: string) {
    this.takenBack.delete(token)
  }

  private recorded(ids: string | readonly string[], changes: ChangeSet, before: Text) {
    const all = typeof ids === 'string' ? [ids] : [...ids]
    this.mapSpans(changes.desc)
    this.steps.push(all, changes, before)
    const spans = spansOf(changes, before)
    const now = Date.now()
    for (const id of all) {
      this.where.set(id, spans)
      if (!this.when.has(id)) this.when.set(id, now)
    }
    this.tell()
  }

  private tookBack(ids: readonly string[], changes: ChangeSet, before: Text, token?: string) {
    for (const id of ids) this.where.delete(id)
    this.mapSpans(changes.desc)
    this.mapTaken(changes.desc)
    if (token) this.takenBack.set(token, { ids: [...ids], changes: changes.invert(before) })
    this.tell()
  }

  private carry(change: ChangeDesc) {
    this.steps.carry(change)
    this.mapSpans(change)
    this.mapTaken(change)
  }

  private mapTaken(change: ChangeDesc) {
    if (change.empty) return
    for (const [name, back] of this.takenBack) {
      this.takenBack.set(name, { ...back, changes: back.changes.map(change) })
    }
  }

  private mapSpans(change: ChangeDesc) {
    if (change.empty) return
    for (const [id, spans] of this.where) {
      const left = spans.map((span) => spanThrough(span, change)).filter((one) => one !== null)
      if (left.length) this.where.set(id, left)
      else this.where.delete(id)
    }
  }

  undoOpen(note: NoteDoc): number {
    this.catchUp(note, note.live.text.toString())
    const before = note.live.text
    const all = this.steps.takeAll()
    if (!all) return 0

    const marks: Mark[] = all.ids.map((id) => ({ id, undone: true }))
    const changes = this.quietly(() =>
      note.live.edit(all.changes, { userEvent: UNDO_EVENT, marks }),
    )
    this.tookBack(all.ids, changes, before)
    return all.ids.length
  }

  undoClosed(
    words: string,
  ): { edits: Replacement[]; after: string; count: number; refused: () => void } | null {
    this.catchUp(null, words)
    const refused = this.saved()
    const all = this.steps.takeAll()
    if (!all) return null

    const before = ropeOf(words)
    const after = all.changes.apply(before).toString()
    this.seen = after
    this.tookBack(all.ids, all.changes, before)
    return { edits: replacementsOf(all.changes), after, count: all.ids.length, refused }
  }

  private hold(note: NoteDoc) {
    const stop = note.live.listen((heard) => {
      this.heard(heard)
    })
    this.held = { note, stop }
    this.seen = null
  }

  setAside() {
    this.letGo()
  }

  get says(): string | null {
    return this.held ? this.held.note.live.text.toString() : this.seen
  }

  private letGo() {
    if (!this.held) return

    this.seen = this.held.note.live.text.toString()
    this.held.stop()
    this.held = null
  }

  private heard(heard: Heard) {
    if (this.making) return

    if (heard.by === 'switch') {
      this.seen = heard.before.toString()
      this.held?.stop()
      this.held = null
      return
    }

    const had = new Set(this.steps.ids)
    if (this.steps.heard(heard)) {
      this.mapSpans(heard.changes.desc)
      this.mapTaken(heard.changes.desc)
      const now = this.steps.ids
      for (const id of had) if (!now.includes(id)) this.where.delete(id)
      const spans = spansOf(heard.changes, heard.before)
      for (const id of now) if (!had.has(id)) this.where.set(id, spans)
    } else {
      this.carry(heard.changes.desc)
    }
    this.tell()
  }

  private tell() {
    if (this.where.size > this.steps.ids.length) {
      const ids = new Set(this.steps.ids)
      for (const id of this.where.keys()) if (!ids.has(id)) this.where.delete(id)
    }
    if (this.steps.size === this.said) return

    this.said = this.steps.size
    this.told(this.said)
  }

  private quietly<T>(make: () => T): T {
    this.making = true
    try {
      return make()
    } finally {
      this.making = false
    }
  }
}
