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
  type StateCommand,
} from '@codemirror/state'
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { type FindSpec, type FindTally, findShown, MOST_COUNTED, NO_TALLY } from './find'
import { onThePage } from './live-preview/hidden-front-matter'

export function tally(state: EditorState): FindTally {
  const query = getSearchQuery(state)
  if (!query.valid) return NO_TALLY

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
  if (!query.valid) return Decoration.none

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
    }

    update(update: ViewUpdate) {
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
        query.wholeWord !== before.wholeWord
      ) {
        this.decorations = marksIn(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

export function searching(): Extension {
  return [search(), findHighlighter, highlightSelectionMatches()]
}

function onPage(_match: string, state: EditorState, from: number): boolean {
  return onThePage(state, from)
}

export function queryFor(spec: FindSpec): SearchQuery {
  return new SearchQuery({
    search: spec.query,
    replace: spec.replace,
    caseSensitive: spec.caseSensitive,
    regexp: spec.regexp,
    wholeWord: spec.wholeWord,
    test: onPage,
  })
}

export function setQuery(view: EditorView, spec: FindSpec) {
  view.dispatch({ effects: setSearchQuery.of(queryFor(spec)) })
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
