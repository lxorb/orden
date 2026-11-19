// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldable, foldedRanges, foldEffect } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import {
  findExtensions,
  loadFind,
  NO_FIND,
  selectEveryMatch,
  selectNextOccurrence,
  selectSelectionMatches,
  setFind,
} from './find'
import { folding } from './fold'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await loadFind()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function folds(view: EditorView) {
  const out: [number, number][] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    out.push([from, to])
  })
  return out
}
const doc = '# Intro\n\ntarget first\n\n# Plan\n\nsome target words here\n\n# Next\n\nend'
const heading = doc.indexOf('# Plan') + '# Plan'.length
const sectionEnd = doc.indexOf('words here') + 'words here'.length
const first = doc.indexOf('target')
const hidden = doc.indexOf('target', first + 1)
function foldedView() {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(first, first + 'target'.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        EditorState.allowMultipleSelections.of(true),
        folding(),
        findExtensions(),
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  const section = foldable(view.state, heading - '# Plan'.length, heading)
  expect(section).toEqual({ from: heading, to: sectionEnd })
  if (section) view.dispatch({ effects: foldEffect.of(section) })
  expect(folds(view)).toEqual([[heading, sectionEnd]])
  return view
}
function picked(view: EditorView) {
  return view.state.selection.ranges.map((range) => [range.from, range.to])
}
const both = [
  [first, first + 'target'.length],
  [hidden, hidden + 'target'.length],
]
describe('adding a match inside a folded section to the selection', () => {
  test('Ctrl+D opens the fold the next occurrence lands in', () => {
    const view = foldedView()
    selectNextOccurrence(view)
    expect(picked(view)).toEqual(both)
    expect(folds(view)).toEqual([])
  })
  test('select every occurrence opens the folds its carets land in', () => {
    const view = foldedView()
    selectSelectionMatches(view)
    expect(picked(view)).toEqual(both)
    expect(folds(view)).toEqual([])
  })
  test('select every find match opens the folds its carets land in', async () => {
    const view = foldedView()
    await setFind(view, { ...NO_FIND, query: 'target' })
    selectEveryMatch(view)
    expect(picked(view)).toEqual(both)
    expect(folds(view)).toEqual([])
  })
})
