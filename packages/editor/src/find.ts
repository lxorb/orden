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
}

const findAsked = StateEffect.define<FindAsk | null>()

export const findShown = StateField.define<boolean>({
  create: () => false,
  update(up, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(findAsked)) return effect.value !== null
    }
    return up
  },
})

export function termAt(state: EditorState): string {
  const { from, to, empty } = state.selection.main
  if (empty || to > from + 100) return ''

  return state.sliceDoc(from, to).trim().replace(/\n/g, '\\n')
}

export const MOST_COUNTED = 300

export interface FindTally {
  count: number
  current: number
  capped: boolean
}

export const NO_TALLY: FindTally = { count: 0, current: -1, capped: false }

const engine = new Compartment()

let loaded: typeof import('./finding') | null = null

export const loadFind: () => Promise<typeof import('./finding')> = door(() =>
  import('./finding').then((module) => {
    loaded = module
    for (const view of openViews())
      view.dispatch({ effects: engine.reconfigure(module.searching()) })

    return module
  }),
)

export function findExtensions(onFind?: (ask: FindAsk | null) => void): Extension {
  return [
    findShown,
    engine.of(loaded ? loaded.searching() : []),
    enrolled,
    ...(onFind
      ? [
          EditorView.updateListener.of((update) => {
            for (const transaction of update.transactions) {
              for (const effect of transaction.effects) {
                if (effect.is(findAsked)) onFind(effect.value)
              }
            }
          }),
        ]
      : []),
  ]
}

function asks(replace: boolean): Command {
  return (view) => {
    if (!loaded) void loadFind()
    view.dispatch({ effects: findAsked.of({ replace, seed: termAt(view.state) }) })

    return true
  }
}

export const openFind = asks(false)
export const openReplace = asks(true)

export function closeFind(view: EditorView) {
  if (view.state.field(findShown, false)) view.dispatch({ effects: findAsked.of(null) })
}

export async function setFind(view: EditorView, spec: FindSpec): Promise<void> {
  const found = loaded ?? (await loadFind())
  found.setQuery(view, spec)
}

export function findTally(state: EditorState): FindTally {
  return loaded ? loaded.tally(state) : NO_TALLY
}

function steps(move: (found: typeof import('./finding')) => Command): Command {
  return (view) => {
    const found = loaded
    if (!found?.asked(view.state)) return openFind(view)

    return move(found)(view)
  }
}

export const findNext = steps((found) => found.next)
export const findPrevious = steps((found) => found.previous)

export function replaceHere(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return loaded.replaceOne(view)
}

export function replaceEverywhere(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return loaded.replaceEvery(view)
}

export function selectEveryMatch(view: EditorView): boolean {
  if (!loaded?.asked(view.state)) return false

  return loaded.selectEvery(view)
}

function lazily(pick: (found: typeof import('./finding')) => Command): Command {
  return (view) => {
    if (loaded) return pick(loaded)(view)
    void loadFind().then((found) => pick(found)(view))

    return true
  }
}

function lazilyOnState(pick: (found: typeof import('./finding')) => StateCommand): StateCommand {
  return (target) => {
    if (loaded) return pick(loaded)(target)
    void loadFind().then((found) => pick(found)(target))

    return true
  }
}

export const gotoLine = lazily((found) => found.gotoLine)

export const selectNextOccurrence = lazilyOnState((found) => found.selectNextOccurrence)
export const selectSelectionMatches = lazilyOnState((found) => found.selectSelectionMatches)
