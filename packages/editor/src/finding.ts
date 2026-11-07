import {
  findNext as libraryNext,
  findPrevious as libraryPrevious,
  getSearchQuery,
  gotoLine as libraryGotoLine,
  highlightSelectionMatches,
  replaceAll as libraryReplaceAll,
  replaceNext as libraryReplaceNext,
  search,
  SearchQuery,
  selectMatches as librarySelectEvery,
  selectNextOccurrence as librarySelectNext,
  selectSelectionMatches as librarySelectMatches,
  setSearchQuery,
} from '@codemirror/search'
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type StateCommand,
  type Text,
} from '@codemirror/state'
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import {
  type FindSpec,
  type FindTally,
  findShown,
  MOST_COUNTED,
  NO_TALLY,
  SLOW_TALLY,
} from './find'
import { quickEnough } from './find-trial'

interface Vetting {
  doc: Text
  slow: boolean
}

const vetted = StateEffect.define<Text>()

const refused = StateEffect.define()

const vetting = StateField.define<Vetting>({
  create: (state) => ({ doc: state.doc, slow: false }),
  update(was, transaction) {
    let now = was
    for (const effect of transaction.effects) {
      if (effect.is(setSearchQuery)) now = { doc: transaction.state.doc, slow: false }
      else if (effect.is(refused)) now = { doc: transaction.state.doc, slow: true }
      else if (effect.is(vetted) && effect.value === transaction.state.doc)
        now = { doc: effect.value, slow: false }
    }
    return now
  },
})

const NOTHING = new SearchQuery({ search: '' })

const MULTILINE = /\\[sWDnr]|\n|\r|\[\^/

function flagsOf(query: SearchQuery): string {
  return query.caseSensitive ? 'gmu' : 'gmui'
}

const tried = new WeakMap<Text, Map<string, Promise<boolean>>>()

function quickOn(query: SearchQuery, doc: Text): Promise<boolean> {
  const flags = flagsOf(query)
  const key = `${flags}\0${query.search}`
  let held = tried.get(doc)
  if (!held) tried.set(doc, (held = new Map<string, Promise<boolean>>()))
  let verdict = held.get(key)
  if (!verdict) {
    verdict = quickEnough(query.search, flags, doc.toString(), !MULTILINE.test(query.search))
    held.set(key, verdict)
  }
  return verdict
}

export function cleared(state: EditorState): boolean {
  const query = getSearchQuery(state)
  return !query.regexp || !query.valid || state.field(vetting, false)?.doc === state.doc
}

export function slow(state: EditorState): boolean {
  return state.field(vetting, false)?.slow === true
}

const running = new WeakMap<EditorView, Promise<boolean>>()

export function clear(view: EditorView): Promise<boolean> {
  const held = running.get(view)
  if (held) return held

  const made = (async () => {
    for (;;) {
      const { state } = view
      if (cleared(state)) return true
      const query = getSearchQuery(state)
      const quick = await quickOn(query, state.doc)
      if (view.state.doc !== state.doc || getSearchQuery(view.state) !== query) continue
      view.dispatch({
        effects: quick ? vetted.of(state.doc) : [setSearchQuery.of(NOTHING), refused.of(null)],
      })
      return quick
    }
  })().finally(() => running.delete(view))
  running.set(view, made)
  return made
}

export function tally(state: EditorState): FindTally {
  if (slow(state)) return SLOW_TALLY
  const query = getSearchQuery(state)
  if (!query.valid || !cleared(state)) return NO_TALLY

  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let count = 0
  let current = -1

  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    if (step.value.from === from && step.value.to === to) current = count
    count += 1
    if (count >= MOST_COUNTED) return { count, current, capped: true }
  }

  return { count, current, capped: false }
}

const findMarks = Decoration.mark({ class: 'cm-searchMatch' })
const findHere = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })

function marksIn(view: EditorView): DecorationSet {
  if (!view.state.field(findShown, false)) return Decoration.none

  const query = getSearchQuery(view.state)
  if (!query.valid || !cleared(view.state)) return Decoration.none

  const built = new RangeSetBuilder<Decoration>()
  for (const range of view.visibleRanges) {
    const cursor = query.getCursor(view.state, range.from, range.to)
    let seen = 0
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      const { from, to } = step.value
      if (to > from) {
        const here = view.state.selection.ranges.some((one) => one.from === from && one.to === to)
        built.add(from, to, here ? findHere : findMarks)
      }
      if (++seen >= MOST_COUNTED) break
    }
  }

  return built.finish()
}

const findHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = marksIn(view)
      if (!cleared(view.state)) void clear(view)
    }

    update(update: ViewUpdate) {
      if (!cleared(update.state)) {
        this.decorations = this.decorations.map(update.changes)
        void clear(update.view)
        return
      }
      const was = update.startState.field(findShown, false)
      const now = update.state.field(findShown, false)
      const query = getSearchQuery(update.state)
      const before = getSearchQuery(update.startState)

      if (
        was !== now ||
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        query.search !== before.search ||
        query.caseSensitive !== before.caseSensitive ||
        query.regexp !== before.regexp ||
        query.wholeWord !== before.wholeWord ||
        update.state.field(vetting) !== update.startState.field(vetting)
      ) {
        this.decorations = marksIn(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

export function searching(): Extension {
  return [search(), vetting, findHighlighter, highlightSelectionMatches()]
}

export function queryFor(spec: FindSpec): SearchQuery {
  return new SearchQuery({
    search: spec.query,
    replace: spec.replace,
    caseSensitive: spec.caseSensitive,
    regexp: spec.regexp,
    wholeWord: spec.wholeWord,
  })
}

const asking = new WeakMap<EditorView, number>()

export async function setQuery(view: EditorView, spec: FindSpec): Promise<void> {
  const query = queryFor(spec)
  const turn = (asking.get(view) ?? 0) + 1
  asking.set(view, turn)

  for (;;) {
    const { doc } = view.state
    const quick = !query.regexp || !query.valid || (await quickOn(query, doc))
    if (asking.get(view) !== turn) return
    if (view.state.doc !== doc) continue
    view.dispatch({
      effects: quick ? setSearchQuery.of(query) : [setSearchQuery.of(NOTHING), refused.of(null)],
    })
    return
  }
}

export function asked(state: EditorState): boolean {
  return getSearchQuery(state).valid
}

export const next: Command = libraryNext
export const previous: Command = libraryPrevious
export const replaceOne: Command = libraryReplaceNext
export const replaceEvery: Command = libraryReplaceAll
export const gotoLine: Command = libraryGotoLine
export const selectEvery: Command = librarySelectEvery
export const selectNextOccurrence: StateCommand = librarySelectNext
export const selectSelectionMatches: StateCommand = librarySelectMatches
