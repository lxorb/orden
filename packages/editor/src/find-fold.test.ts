// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldable, foldedRanges, foldEffect } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { findExtensions, findNext, loadFind, NO_FIND, setFind } from './find'
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

describe('finding a word in a folded section', () => {
  test('opens the fold when the word ends the section', async () => {
    const doc = '# Plan\n\nsome words then target\n\n# Next\n\nmore'
    const heading = '# Plan'.length
    const end = doc.indexOf('target') + 'target'.length
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          folding(),
          findExtensions(),
        ],
      }),
    )
    const view = new EditorView({ state, parent: document.body })
    open.push(view)
    const section = foldable(view.state, 0, heading)
    expect(section).toEqual({ from: heading, to: end })
    if (section) view.dispatch({ effects: foldEffect.of(section) })
    expect(folds(view)).toEqual([[heading, end]])

    await setFind(view, { ...NO_FIND, query: 'target' })
    view.dispatch({ selection: EditorSelection.cursor(0) })
    findNext(view)

    expect(view.state.selection.main.to).toBe(end)
    expect(folds(view)).toEqual([])
  })
})
