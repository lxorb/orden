import { history, invertedEffects, isolateHistory, redo, undo } from '@codemirror/commands'
import {
  ChangeSet,
  type ChangeSpec,
  type EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  StateEffect,
  StateField,
  type Text,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { fold } from '@orden/rooms/fold'
import { external, isExternal } from './external'

export interface DocView {
  readonly state: EditorState
  dispatch(spec: TransactionSpec): void
  readonly composing?: boolean
}

const onDocument = new WeakMap<DocView, SharedDoc>()

export function documentOf(view: DocView): SharedDoc | null {
  return onDocument.get(view) ?? null
}

export function later(
  view: DocView,
): (write: (state: EditorState) => TransactionSpec | null) => boolean {
  const asked = view.state
  const note = documentOf(view)

  return (write) => {
    if (documentOf(view) === note) {
      const spec = write(view.state)
      if (spec) view.dispatch(spec)
      return spec !== null
    }

    if (!note?.text.eq(asked.doc)) return true
    const spec = write(asked)
    if (!spec) return false

    const made = asked.update(spec)
    note.local(made.changes, made.newSelection, view, made.annotation(Transaction.userEvent))
    return true
  }
}

export function letGo(view: DocView) {
  onDocument.get(view)?.leave(view)
}

const setShared = StateEffect.define<SharedDoc | null>()

const sharedField = StateField.define<SharedDoc | null>({
  create: () => null,
  update: (current, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setShared)) return effect.value
    }

    return current
  },
})

export function sharedOf(state: EditorState): SharedDoc | null {
  return state.field(sharedField, false) ?? null
}

interface Landing {
  view: DocView
  selection: EditorSelection
}

interface Replacement {
  from: number
  to: number
  insert: string
}

export type Made = 'reader' | 'outside' | 'room'

export interface Mark {
  id: string
  undone: boolean
}

const marked = StateEffect.define<Mark>()

const marksKept = invertedEffects.of((transaction) =>
  transaction.effects.flatMap((effect) =>
    effect.is(marked) ? [marked.of({ id: effect.value.id, undone: !effect.value.undone })] : [],
  ),
)

const leads = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const trails = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

function parted(doc: Text, at: number): boolean {
  if (at <= 0 || at >= doc.length) return false
  const halves = doc.sliceString(at - 1, at + 1)
  return leads(halves.charCodeAt(0)) && trails(halves.charCodeAt(1))
}

const wholeCharacters = EditorState.transactionFilter.of((made) => {
  if (!made.docChanged || isExternal(made)) return made

  const before = made.startState.doc
  const doc = made.newDoc
  const mended: ChangeSpec[] = []
  made.changes.iterChanges((fromA, toA, fromB, toB) => {
    const first = parted(before, fromA) && !parted(doc, fromB)
    const second = parted(before, toA) && !parted(doc, toB)

    if (first && second && fromA === toA) {
      mended.push({ from: fromB, insert: doc.sliceString(toB, toB + 1) })
      mended.push({ from: toB, to: toB + 1 })
    } else {
      if (first) mended.push({ from: fromB - 1, to: fromB })
      if (second) mended.push({ from: toB, to: toB + 1 })
    }

    const start = Math.max(fromB - 1, 0)
    const words = doc.sliceString(start, Math.min(toB + 1, doc.length))
    for (let at = fromB; at < toB; at++) {
      const unit = words.charCodeAt(at - start)
      const half = leads(unit)
        ? !trails(words.charCodeAt(at - start + 1))
        : trails(unit) && !leads(words.charCodeAt(at - start - 1))
      if (half) mended.push({ from: at, to: at + 1 })
    }
  })

  return mended.length ? [made, { changes: mended, sequential: true }] : made
})

function documentState(doc: string | Text): EditorState {
  return EditorState.create({ doc, extensions: [history(), marksKept, wholeCharacters] })
}

export interface Heard {
  changes: ChangeSet
  before: Text
  by: Made | 'switch'
  marks: readonly Mark[]
}

export interface Stepped {
  userEvent: string
  marks?: readonly Mark[]
}

const REMEMBERED = 400

function holds(doc: Text, words: string): boolean {
  if (doc.length !== words.length) return false

  let at = 0
  for (const chunk = doc.iter(); !chunk.next().done; at += chunk.value.length) {
    if (!words.startsWith(chunk.value, at)) return false
  }

  return true
}

export class SharedDoc {
  private state: EditorState

  private readonly views = new Set<DocView>()

  onChange: ((doc: Text) => void) | null = null

  onLocal: ((changes: ChangeSet) => void) | null = null

  private ownUndo = 0
  private ownRedo = 0

  private recent: { before: Text; changes: ChangeSet; by: Made; at: number }[] = []

  private held: ChangeSet | null = null

  get holdingBack(): boolean {
    return this.held !== null
  }

  private readonly listeners = new Set<(heard: Heard) => void>()

  get undoable(): number {
    return this.ownUndo
  }

  get redoable(): number {
    return this.ownRedo
  }

  constructor(doc: string | Text = '') {
    this.state = documentState(doc)
  }

  takeOn(text: string) {
    const held = this.state.doc.toString()

    if (held !== text) {
      const change = fold(held, text) ?? { from: 0, to: held.length, insert: text }
      const made = this.state.update({
        changes: change,
        annotations: Transaction.addToHistory.of(false),
        filter: false,
      })

      this.carry(made.changes, null)
      this.tell({ changes: made.changes, before: made.startState.doc, by: 'switch', marks: [] })
    }

    this.state = documentState(text)
    this.recent = []
    this.ownUndo = 0
    this.ownRedo = 0
    this.onChange?.(this.state.doc)
  }

  get text(): Text {
    return this.state.doc
  }

  get roomWords(): Text {
    return this.held ? this.held.apply(this.state.doc) : this.state.doc
  }

  get panes(): number {
    return this.views.size
  }

  join(view: DocView) {
    if (onDocument.get(view) === this) {
      this.views.add(view)
      return
    }

    onDocument.get(view)?.leave(view)
    this.views.add(view)
    onDocument.set(view, this)

    const same = view.state.doc.eq(this.state.doc)
    view.dispatch({
      ...(same ? {} : { changes: { from: 0, to: view.state.doc.length, insert: this.state.doc } }),
      effects: setShared.of(this),
      annotations: external.of(true),
    })
  }

  handOver(leaving: DocView, taking: DocView, move: () => void) {
    const followed = onDocument.get(leaving) === this
    this.leave(leaving)
    move()

    if (!followed) {
      this.join(taking)
      return
    }

    onDocument.get(taking)?.leave(taking)
    this.views.add(taking)
    onDocument.set(taking, this)

    if (sharedOf(taking.state) !== this) {
      taking.dispatch({ effects: setShared.of(this), annotations: external.of(true) })
    }
  }

  leave(view: DocView) {
    this.views.delete(view)
    if (onDocument.get(view) === this) onDocument.delete(view)
    this.settle()
  }

  local(changes: ChangeSet, selection: EditorSelection, from: DocView, userEvent?: string) {
    const made = this.state.update({
      changes,
      selection,
      filter: false,
      ...(userEvent ? { userEvent } : {}),
    })
    this.state = made.state

    this.did()
    this.carry(changes, from)
    this.made(changes)
    this.took(made, 'reader')
    this.settle()
  }

  selected(selection: EditorSelection, userEvent?: string) {
    const length = this.state.doc.length
    if (selection.ranges.some((range) => range.to > length)) return
    this.state = this.state.update({ selection, ...(userEvent ? { userEvent } : {}) }).state
  }

  replace(text: string, recorded = true, changes?: readonly Replacement[]) {
    let change: readonly Replacement[] | Replacement
    if (changes) {
      if (!changes.length) return
      change = changes
    } else {
      const held = this.state.doc.toString()
      if (held === text) return
      change = fold(held, text) ?? { from: 0, to: held.length, insert: text }
    }

    const made = this.state.update({
      changes: change,
      ...(recorded ? {} : { annotations: Transaction.addToHistory.of(false) }),
    })

    this.state = made.state
    if (recorded) this.did()
    this.carry(made.changes, null)
    this.made(made.changes)
    this.took(made, 'outside')
  }

  private did() {
    this.ownUndo++
    this.ownRedo = 0
  }

  edit(changes: readonly Replacement[] | ChangeSet, stepped?: Stepped): ChangeSet {
    const made = this.state.update({
      changes,
      ...(stepped
        ? {
            annotations: [Transaction.userEvent.of(stepped.userEvent), isolateHistory.of('full')],
            effects: (stepped.marks ?? []).map((mark) => marked.of(mark)),
          }
        : {}),
    })

    this.state = made.state
    this.did()
    this.carry(made.changes, null)
    this.made(made.changes)
    this.took(made, 'outside')
    return made.changes
  }

  arrived(changes: readonly Replacement[] | ChangeSet) {
    if (this.held || this.composing()) {
      const length = this.held ? this.held.newLength : this.state.doc.length
      const set = changes instanceof ChangeSet ? changes : ChangeSet.of(changes, length)
      this.held = this.held ? this.held.compose(set) : set
      this.settle()
      return
    }

    const made = this.state.update({
      changes,
      annotations: Transaction.addToHistory.of(false),
      filter: false,
    })

    this.state = made.state
    this.carry(made.changes, null)
    this.onChange?.(this.state.doc)
    this.took(made, 'room')
  }

  announce(effects: readonly StateEffect<unknown>[]) {
    if (!effects.length) return

    for (const view of this.views) {
      view.dispatch({ effects: [...effects], annotations: external.of(true), filter: false })
    }
  }

  undo(asked: DocView): boolean {
    if (!this.ownUndo) return false
    if (!this.step(undo, asked)) return false

    this.ownUndo--
    this.ownRedo++
    return true
  }

  redo(asked: DocView): boolean {
    if (!this.ownRedo) return false
    if (!this.step(redo, asked)) return false

    this.ownRedo--
    this.ownUndo++
    return true
  }

  private step(command: StateCommand, asked: DocView): boolean {
    const made: { transaction: Transaction | null } = { transaction: null }

    const ran = command({
      state: this.state,
      dispatch: (transaction) => {
        made.transaction = transaction
      },
    })

    const done = made.transaction
    if (!ran || !done) return false

    this.state = done.state
    this.carry(done.changes, null, { view: asked, selection: done.state.selection })
    this.made(done.changes)
    this.took(done, 'reader')
    return true
  }

  carried(edits: readonly Replacement[], before: string, guess = false): Replacement[] | null {
    const since = this.since(before) ?? (guess ? this.across(before) : null)
    if (!since) return null
    if (since.empty) return edits.map((edit) => ({ ...edit }))

    const out: Replacement[] = []
    ChangeSet.of(edits, before.length)
      .map(since)
      .iterChanges((from, to, _fromB, _toB, inserted) => {
        out.push({ from, to, insert: inserted.toString() })
      })

    return out
  }

  since(before: string): ChangeSet | null {
    let carried = ChangeSet.empty(this.state.doc.length)
    if (holds(this.state.doc, before)) return carried

    for (let at = this.recent.length - 1; at >= 0; at--) {
      const step = this.recent[at]
      if (!step) break

      carried = step.changes.compose(carried)
      if (holds(step.before, before)) return carried
    }

    return null
  }

  private across(before: string): ChangeSet {
    const span = fold(before, this.state.doc.toString())
    return ChangeSet.of(span ? [span] : [], before.length)
  }

  touchedWithin(ms: number, now = Date.now()): { from: number; to: number }[] {
    const touched: { from: number; to: number }[] = []
    let later = ChangeSet.empty(this.state.doc.length)

    for (let at = this.recent.length - 1; at >= 0; at--) {
      const step = this.recent[at]
      if (!step || now - step.at > ms) break

      if (step.by === 'reader') {
        step.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          touched.push({ from: later.mapPos(fromB, -1), to: later.mapPos(toB, 1) })
        })
      }

      later = step.changes.compose(later)
    }

    return touched
  }

  get readerAt(): number | null {
    for (let at = this.recent.length - 1; at >= 0; at--) {
      const step = this.recent[at]
      if (step?.by === 'reader') return step.at
    }
    return null
  }

  listen(listener: (heard: Heard) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private took(made: Transaction, by: Made) {
    this.recent.push({ before: made.startState.doc, changes: made.changes, by, at: Date.now() })
    if (this.recent.length > REMEMBERED * 2) this.recent = this.recent.slice(-REMEMBERED)

    if (!this.listeners.size) return
    const marks = made.effects.flatMap((effect) => (effect.is(marked) ? [effect.value] : []))
    this.tell({ changes: made.changes, before: made.startState.doc, by, marks })
  }

  private tell(heard: Heard) {
    for (const listener of [...this.listeners]) listener(heard)
  }

  private made(changes: ChangeSet) {
    if (this.held) {
      const theirs = this.held
      this.held = theirs.map(changes, true)
      this.onLocal?.(changes.map(theirs))
    } else {
      this.onLocal?.(changes)
    }
    this.onChange?.(this.state.doc)
  }

  private composing(): boolean {
    for (const view of this.views) if (view.composing) return true
    return false
  }

  settle() {
    if (!this.held || this.composing()) return
    const held = this.held
    this.held = null
    if (!held.empty) this.arrived(held)
  }

  private carry(changes: ChangeSet, from: DocView | null, landing?: Landing) {
    for (const view of this.views) {
      if (view === from) continue

      view.dispatch({
        changes,
        ...(landing?.view === view ? { selection: landing.selection, scrollIntoView: true } : {}),
        annotations: external.of(true),
        filter: false,
      })
    }
  }
}

export function sharing(): Extension {
  return [
    sharedField,
    wholeCharacters,
    EditorState.transactionExtender.of((transaction) =>
      sharedOf(transaction.startState) ? { annotations: Transaction.addToHistory.of(false) } : null,
    ),
    EditorView.domEventHandlers({
      compositionend: (_event, view) => {
        setTimeout(() => documentOf(view)?.settle(), 0)
      },
    }),
  ]
}

export const undoEdit: Command = (view) => {
  const shared = documentOf(view)
  return shared ? shared.undo(view) : undo(view)
}

export const redoEdit: Command = (view) => {
  const shared = documentOf(view)
  return shared ? shared.redo(view) : redo(view)
}

export function fromInput(inputType: string): Command | null {
  if (inputType === 'historyUndo') return undoEdit
  if (inputType === 'historyRedo') return redoEdit
  return null
}
