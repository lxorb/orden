// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldable, foldedRanges, foldEffect } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { folding } from '../fold'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { footnoteAt, followFootnote } from './footnotes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
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

describe('jumping back from a footnote into a folded section', () => {
  test('opens the fold when the mark ends the section', () => {
    const doc = '## Intro\n\nSome claim.[^1]\n\n## Notes\n\n[^1]: The source.'
    const heading = '## Intro'.length
    const mark = doc.indexOf('[^1]') + '[^1]'.length
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), folding()],
      }),
    )
    const view = new EditorView({ state, parent: document.body })
    open.push(view)
    const section = foldable(view.state, 0, heading)
    expect(section).toEqual({ from: heading, to: mark })
    if (section) view.dispatch({ effects: foldEffect.of(section) })

    const definition = footnoteAt(view.state, doc.lastIndexOf('[^1]') + 2)
    expect(definition?.kind).toBe('def')
    if (definition) followFootnote(view, definition)

    expect(view.state.selection.main.head).toBe(mark)
    expect(folds(view)).toEqual([])
  })
})
