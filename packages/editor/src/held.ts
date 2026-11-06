import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state'
import type { DocView, SharedDoc } from './shared'

export interface StateView extends DocView {
  setState(state: EditorState): void
  scrollSnapshot(): StateEffect<unknown>
  readonly scrollDOM: { scrollTop: number }
}

interface EditContextKeeper {
  pendingContextChange: unknown
  composing: unknown
  reset(state: EditorState): void
}

function keeperOf(view: StateView): EditContextKeeper | null {
  return (
    (view as { observer?: { editContext?: EditContextKeeper | null } }).observer?.editContext ??
    null
  )
}

function endComposing(view: StateView): () => void {
  const real = view as StateView & { contentDOM?: HTMLElement; focus?: () => void }
  if (!real.contentDOM || !keeperOf(view)?.composing) return () => undefined
  real.contentDOM.blur()
  return () => real.focus?.()
}

function fillEditContext(view: StateView) {
  const keeper = keeperOf(view)
  if (!keeper) return
  keeper.pendingContextChange = null
  keeper.composing = null
  keeper.reset(view.state)
}

export class HeldState implements DocView {
  private held: EditorState
  private place: StateEffect<unknown> | null

  private constructor(
    private readonly note: SharedDoc,
    state: EditorState,
    place: StateEffect<unknown> | null,
  ) {
    this.held = state
    this.place = place
  }

  static waiting(
    note: SharedDoc,
    state: EditorState,
    place: StateEffect<unknown> | null = null,
  ): HeldState {
    const held = new HeldState(note, state, place)
    note.join(held)
    return held
  }

  static shownIn(
    note: SharedDoc,
    view: StateView,
    place: StateEffect<unknown> | null = null,
  ): HeldState {
    return new HeldState(note, view.state, place)
  }

  get state(): EditorState {
    return this.held
  }

  dispatch(spec: TransactionSpec) {
    const made = this.held.update(spec)
    this.held = made.state

    if (this.place && !made.changes.empty) this.place = this.place.map(made.changes) ?? null
  }

  give(view: StateView, effects: readonly StateEffect<unknown>[] = []) {
    this.note.handOver(this, view, () => {
      const refocus = endComposing(view)
      view.setState(this.held)
      fillEditContext(view)
      refocus()
      if (!this.place) view.scrollDOM.scrollTop = 0
    })
    this.settle(view, effects)
  }

  settle(view: StateView, effects: readonly StateEffect<unknown>[] = []) {
    const all = this.place ? [this.place, ...effects] : effects
    if (all.length) view.dispatch({ effects: [...all] })
  }

  take(view: StateView) {
    this.note.handOver(view, this, () => {
      this.held = view.state
      this.place = view.scrollSnapshot()
    })
  }

  release() {
    this.note.leave(this)
  }
}
