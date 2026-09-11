/** Finding words in the note, and putting other words in their place.
 *
 *  The engine is the library's and stays the library's: `SearchQuery` is what
 *  knows about case, whole words and regular expressions, what steps from one
 *  match to the next and what a `$1` in a replacement means. None of that is
 *  worth writing twice.
 *
 *  What is not the library's any more is the bar. CodeMirror ships a panel -
 *  two bare inputs, three checkboxes labelled "match case", "regexp", "by word"
 *  in whatever language the library was written in, and a `x` for a close
 *  button - and it was the one surface in nib that was not nib's: no
 *  `.nib-field`, no row scale, no touch sizes, nothing translated, and a
 *  different shape again from the bar the reading view and a PDF already shared.
 *  So the panel is gone and the app draws the bar; see FindBar.svelte.
 *
 *  Which leaves this file as the seam between the two, and it has three jobs:
 *
 *  1. Ask the app to put the bar up. A command cannot reach a component, so the
 *     keys dispatch an effect and the app is told through `onFind`.
 *  2. Say where the matches are. The library's own highlighter draws nothing
 *     unless the library's own panel is open, which it never is now, so the
 *     marks are drawn here instead - the same two classes, so the stylesheet
 *     that coloured them still does.
 *  3. Count them, which the library does not offer at all and a bar saying
 *     "1 of 5" needs. */

import {
  findNext as libraryNext,
  findPrevious as libraryPrevious,
  getSearchQuery,
  replaceAll as libraryReplaceAll,
  replaceNext as libraryReplaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

/** What the bar is asking of the document. The four the library's query has,
 *  under the names the bar says them in. */
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

/** The bar being asked for, or asked to go. `replace` is whether the row with
 *  Replace and Replace all is wanted open: Ctrl+H asks for the whole of it and
 *  Ctrl+F asks for the top row. */
export interface FindAsk {
  replace: boolean
  /** What the caret was on when the key was pressed, so the bar opens on the
   *  word somebody was looking at. Empty when the selection was empty or too
   *  long to be a search term, which is the rule the library uses too. */
  seed: string
}

const findAsked = StateEffect.define<FindAsk | null>()

/** Whether the app's bar is up. What the marks below follow: the matches are
 *  shown while somebody is looking for them and not a moment longer. */
const findShown = StateField.define<boolean>({
  create: () => false,
  update(up, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(findAsked)) return effect.value !== null
    }
    return up
  },
})

/** The words the caret is on, as a search term. A selection spanning half the
 *  note is not a term anybody meant to look for; a hundred characters is where
 *  the library draws that line and there is no reason to draw it elsewhere.
 *
 *  Exported because it is the rule that decides what the bar opens on, and a
 *  rule is worth a test. */
export function termAt(state: EditorState): string {
  const { from, to, empty } = state.selection.main
  if (empty || to > from + 100) return ''

  // Trimmed, because a selection made with Ctrl+Shift+Right carries the space
  // in front of the word and nobody means to look for that. A term with a
  // newline in it cannot be typed into a one-line field either, and the library
  // escapes it for the same reason.
  return state.sliceDoc(from, to).trim().replace(/\n/g, '\\n')
}

/** How far the count will go. A note is a file somebody wrote, not a corpus,
 *  and a regular expression over a long one can match on nearly every
 *  character: the bar says "300+" rather than spending a frame being exact
 *  about a number nobody reads. */
const MOST_COUNTED = 300

export interface FindTally {
  /** How many matches there are, or `MOST_COUNTED` when there are more. */
  count: number
  /** Which one the selection is on, counting from zero, or -1 for none. */
  current: number
  /** Whether the count stopped before the end of the note. */
  capped: boolean
}

export const NO_TALLY: FindTally = { count: 0, current: -1, capped: false }

/** Every match, up to the cap, and which of them the selection is sitting on.
 *
 *  One pass, because the two answers come from the same walk. A zero-width
 *  match - `a*` over a line of b's - would otherwise be walked forever, so the
 *  cursor's own end is what stops it and a match that does not advance is
 *  counted once and left. */
export function findTally(state: EditorState): FindTally {
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

/** The marks under the matches: the library's own two class names, so the
 *  colours in the editor's theme are the ones that were already there.
 *
 *  Only the visible stretch is walked, the way the library's own does, and only
 *  while the bar is up. */
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

/** Everything the editor needs to be searchable, with the app drawing the bar.
 *
 *  `search()` is included outright rather than left to arrive with the library's
 *  panel: the query has to be a field from the first frame, because the bar sets
 *  it before anything has opened a panel and `setSearchQuery` does nothing
 *  without one. */
export function findExtensions(onFind?: (ask: FindAsk | null) => void): Extension {
  return [
    search(),
    findShown,
    findHighlighter,
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

/** Asks for the bar. Both keys land here; which row the keyboard goes to is the
 *  bar's business, and `replace` is what says which it should be. */
function asks(replace: boolean): Command {
  return (view) => {
    view.dispatch({ effects: findAsked.of({ replace, seed: termAt(view.state) }) })
    return true
  }
}

export const openFind = asks(false)
export const openReplace = asks(true)

/** Says the bar has gone, which is what takes the marks off the matches. The
 *  caret going back where it was is the bar's own doing. */
export function closeFind(view: EditorView) {
  view.dispatch({ effects: findAsked.of(null) })
}

/** What the bar is looking for. Written as one effect on every keystroke, which
 *  is the whole of how the bar talks to the document. */
export function setFind(view: EditorView, spec: FindSpec) {
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: spec.query,
        replace: spec.replace,
        caseSensitive: spec.caseSensitive,
        regexp: spec.regexp,
        wholeWord: spec.wholeWord,
      }),
    ),
  })
}

/** A step through the matches, or the bar if there is nothing to step through.
 *
 *  The guard is the point. The library pairs every one of these with "and open
 *  the search panel if the query is empty", which would put the panel nib just
 *  replaced back on the screen the first time somebody pressed F3. */
function steps(move: Command): Command {
  return (view) => {
    if (!getSearchQuery(view.state).valid) return openFind(view)
    return move(view)
  }
}

export const findNext = steps(libraryNext)
export const findPrevious = steps(libraryPrevious)

/** The match the caret is on, replaced, and then the one after it. False where
 *  there is nothing to replace or the note cannot be written in. */
export function replaceHere(view: EditorView): boolean {
  if (!getSearchQuery(view.state).valid) return false
  return libraryReplaceNext(view)
}

export function replaceEverywhere(view: EditorView): boolean {
  if (!getSearchQuery(view.state).valid) return false
  return libraryReplaceAll(view)
}
