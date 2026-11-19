import {
  Compartment,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type StateCommand,
} from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { door } from '@orden/markdown/door'
import { enrolled, openViews } from './open-views'

export interface FindSpec {
  query: string
  replace: string
  caseSensitive: boolean
  regexp: boolean
  wholeWord: boolean
}

export const NO_FIND: FindSpec = {
  query: '',
  replace: '',
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
}

export interface FindAsk {
  replace: boolean
  seed: string
  pattern: string
}

const findAsked = StateEffect.define<FindAsk | null>()

export const findShown = StateField.define<boolean>({
  create: () => false,
  update(up, transaction) {
    for (const effect of transaction.effects) if (effect.is(findAsked)) return effect.value !== null
    return up
  },
})

const PATTERN_SYNTAX = /[\\^$.*+?()[\]{}|]/g

function asTyped(selected: string): string {
  return selected.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

function asPattern(selected: string): string {
  return selected.replace(PATTERN_SYNTAX, '\\$&').replace(/\n/g, '\\n')
}

export function termAt(state: EditorState, regexp = false): string {
  const { from, to, empty } = state.selection.main
  if (empty || to > from + 100) return ''

  const selected = state.sliceDoc(from, to).trim()
  return regexp ? asPattern(selected) : asTyped(selected)
}

export const MOST_COUNTED = 300

export interface FindTally {
  count: number
  current: number
  capped: boolean
  slow?: boolean
}

export const NO_TALLY: FindTally = { count: 0, current: -1, capped: false }

export const SLOW_TALLY: FindTally = { ...NO_TALLY, slow: true }

const engine = new Compartment()

let loaded: typeof import('./finding') | null = null

export const loadFind: () => Promise<typeof import('./finding')> = door(() =>
  import('./finding').then((module) => {
    loaded = module
    for (const view of openViews()) view.dispatch({ effects: engine.reconfigure(module.searching()) })

    return module
  }),
)

export function findExtensions(onFind?: (ask: FindAsk | null) => void, onSlow?: (view: EditorView) => void): Extension {
  return [
    findShown,
    engine.of(loaded ? loaded.searching() : []),
    enrolled,
    ...(onFind
      ? [
          EditorView.updateListener.of((update) => {
            for (const transaction of update.transactions)
              for (const effect of transaction.effects) if (effect.is(findAsked)) onFind(effect.value)
          }),
        ]
      : []),
    ...(onSlow
      ? [
          EditorView.updateListener.of((update) => {
            if (loaded?.slow(update.state) && !loaded.slow(update.startState)) onSlow(update.view)
          }),
        ]
      : []),
  ]
}

const asks =
  (replace: boolean): Command =>
  (view) => {
    if (!loaded) void loadFind()
    view.dispatch({
      effects: findAsked.of({
        replace,
        seed: termAt(view.state),
        pattern: termAt(view.state, true),
      }),
    })

    return true
  }

export const openFind = asks(false)
export const openReplace = asks(true)

export function closeFind(view: EditorView) {
  if (view.state.field(findShown, false)) view.dispatch({ effects: findAsked.of(null) })
}

export async function setFind(view: EditorView, spec: FindSpec): Promise<void> {
  const found = loaded ?? (await loadFind())
  await found.setQuery(view, spec)
}

export const findTally = (state: EditorState): FindTally => (loaded ? loaded.tally(state) : NO_TALLY)

export const findReady = (view: EditorView): Promise<boolean> => (loaded ? loaded.clear(view) : Promise.resolve(true))

function once(found: typeof import('./finding'), view: EditorView, run: Command): boolean {
  if (found.cleared(view.state)) return run(view)
  void found.clear(view).then((quick) => quick && found.asked(view.state) && run(view))

  return true
}

const steps =
  (move: (found: typeof import('./finding')) => Command): Command =>
  (view) => {
    const found = loaded
    if (!found?.asked(view.state)) return openFind(view)

    return once(found, view, move(found))
  }

export const findNext = steps((found) => found.next)
export const findPrevious = steps((found) => found.previous)

export function replaceHere(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return once(loaded, view, loaded.replaceOne)
}

export function replaceEverywhere(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return once(loaded, view, loaded.replaceEvery)
}

export function selectEveryMatch(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return once(loaded, view, loaded.selectEvery)
}

const lazily =
  (pick: (found: typeof import('./finding')) => Command): Command =>
  (view) => {
    if (loaded) return pick(loaded)(view)
    void loadFind().then((found) => pick(found)(view))

    return true
  }

const lazilyOnState =
  (pick: (found: typeof import('./finding')) => StateCommand): StateCommand =>
  (target) => {
    if (loaded) return pick(loaded)(target)
    void loadFind().then((found) => pick(found)(target))

    return true
  }

export const gotoLine = lazily((found) => found.gotoLine)
export const selectNextOccurrence = lazilyOnState((found) => found.selectNextOccurrence)
export const selectSelectionMatches = lazilyOnState((found) => found.selectSelectionMatches)
