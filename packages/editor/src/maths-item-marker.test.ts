// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { blockDecorations } from './live-preview/blocks'
import { livePreview } from './live-preview'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), livePreview()],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}
function type(view: EditorView, text: string) {
  for (const key of text) {
    const at = view.state.selection.main.head
    view.dispatch({
      changes: { from: at, insert: key },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    })
  }
}
function hidden(view: EditorView, words: string): boolean {
  const at = view.state.doc.toString().indexOf(words)
  let covered = false
  view.state.field(blockDecorations).decorations.between(at, at + words.length, (from, to) => {
    if (from <= at && to >= at + words.length) covered = true
  })
  return covered
}
describe('typing a list marker in front of a maths block', () => {
  test('leaves the heading and words below it shown', () => {
    const view = viewOf('$$\nx^2\n$$\n\n# Plans\n\nThe rest of the note.')
    type(view, '- ')
    expect(view.state.doc.toString()).toBe('- $$\nx^2\n$$\n\n# Plans\n\nThe rest of the note.')
    expect(hidden(view, '# Plans')).toBe(false)
    expect(hidden(view, 'The rest of the note.')).toBe(false)
  })
  test('leaves them shown for a numbered item too', () => {
    const view = viewOf('$$\nx^2\n$$\n\n# Plans\n\nThe rest of the note.')
    type(view, '1. ')
    expect(hidden(view, '# Plans')).toBe(false)
  })
})
