import { untrack } from 'svelte'
import { HeldState, letGo, type SharedDoc, type StateEffect, type StateView } from '@orden/editor'

export interface NoteTab {
  readonly note: { readonly live: SharedDoc; readonly arrivals: number }
}

interface Kept {
  readonly note: NoteTab['note']
  readonly arrivals: number
  readonly state: HeldState
  stamp: string | undefined
}

function noteOf(tab: NoteTab): { note: NoteTab['note']; arrivals: number } {
  return untrack(() => ({ note: tab.note, arrivals: tab.note.arrivals }))
}

export class EditorStates {
  private readonly held = new Map<NoteTab, Kept>()
  private shown: Kept | null = null
  private settled = false

  get count(): number {
    return this.held.size
  }

  shows(tab: NoteTab): boolean {
    const note = tab.note
    const arrivals = note.arrivals
    const kept = this.held.get(tab)

    return (
      kept !== undefined && kept === this.shown && kept.note === note && kept.arrivals === arrivals
    )
  }

  started(tab: NoteTab, view: StateView, place: StateEffect<unknown> | null) {
    const on = noteOf(tab)
    const kept: Kept = {
      note: on.note,
      arrivals: on.arrivals,
      state: HeldState.shownIn(on.note.live, view, place),
      stamp: undefined,
    }

    this.held.set(tab, kept)
    this.shown = kept
  }

  fitted(tab: NoteTab): string | undefined {
    return this.held.get(tab)?.stamp
  }

  fit(tab: NoteTab, stamp: string) {
    const kept = this.held.get(tab)
    if (kept) kept.stamp = stamp
  }

  show(
    view: StateView,
    tab: NoteTab,
    build: () => HeldState,
    effects: readonly StateEffect<unknown>[] = [],
  ): boolean {
    const on = noteOf(tab)
    const had = this.held.get(tab)
    const moved = had && (had.note !== on.note || had.arrivals !== on.arrivals)
    const stale = moved ? had : undefined
    const known = stale ? undefined : had

    const next =
      known ??
      ({ note: on.note, arrivals: on.arrivals, state: build(), stamp: undefined } satisfies Kept)
    if (!known) this.held.set(tab, next)

    if (this.shown === next) {
      if (this.settled) {
        if (effects.length) view.dispatch({ effects: [...effects] })
      } else next.state.settle(view, effects)

      this.settled = true
      return !known
    }

    this.shown?.state.take(view)
    this.shown = next
    this.settled = true
    next.state.give(view, effects)

    stale?.state.release()

    return !known
  }

  keepOnly(tabs: readonly NoteTab[]) {
    const kept = new Set(tabs)

    for (const [tab, one] of this.held) {
      if (one === this.shown || kept.has(tab)) continue

      one.state.release()
      this.held.delete(tab)
    }
  }

  releaseAll(view: StateView) {
    for (const one of this.held.values()) {
      if (one !== this.shown) one.state.release()
    }

    letGo(view)
    this.held.clear()
    this.shown = null
    this.settled = false
  }
}
