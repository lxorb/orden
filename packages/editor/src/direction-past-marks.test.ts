// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { leftToRightLines, rightToLeftLines } from './modes'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string, rtl = false): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        EditorView.contentAttributes.of({ dir: rtl ? 'rtl' : 'ltr' }),
        rtl ? rightToLeftLines : leftToRightLines,
      ],
    }),
    parent: document.body,
  })
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({})
  open.push(view)
  return view
}
function directions(view: EditorView): (string | null)[] {
  return [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.getAttribute('dir'))
}
describe('a right-to-left line led by a mark with a letter in it', () => {
  test('a ticked task reads right to left, as it did before it was ticked', () => {
    const view = viewOf('- [ ] שלום עולם\n- [x] שלום עולם\n- [X] مرحبا\n')
    expect(directions(view)).toEqual(['rtl', 'rtl', 'rtl', null])
  })
  test('in a right-to-left note, a ticked task is not turned left to right', () => {
    const view = viewOf('- [ ] مرحبا\n- [x] مرحبا\n', true)
    expect(directions(view)).toEqual([null, null, null])
  })
  test('a callout titled right to left reads right to left', () => {
    const view = viewOf('> [!note] כותרת\n> גוף\n')
    expect(directions(view)).toEqual(['rtl', 'rtl', null])
  })
})
