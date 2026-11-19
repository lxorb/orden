// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { createEditor } from '../editor'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: doc.length }, userEvent: 'select' })
  return view
}
const CLOSED_BELOW = '<iframe src="https://example.com/map" height="300">\n</iframe>\n\nWords.\n\nend'
const TAG_OVER_LINES = '<iframe\n  src="https://example.com/map"\n  height="300"></iframe>\n\nWords.\n\nend'
describe('a web frame written over more than one line, with the caret elsewhere', () => {
  test('is a card in the reading view', () => {
    expect(renderMarkdown(CLOSED_BELOW)).toContain('embed-web')
    expect(renderMarkdown(TAG_OVER_LINES)).toContain('embed-web')
  })
  test('is drawn as a card in Live Preview when its closing tag is on the next line', () => {
    const view = viewOf(CLOSED_BELOW)
    expect(view.contentDOM.querySelector('.embed-web')).not.toBeNull()
    expect(view.contentDOM.textContent).not.toContain('<iframe')
  })
  test('is drawn as a card in Live Preview when its tag runs over several lines', () => {
    const view = viewOf(TAG_OVER_LINES)
    expect(view.contentDOM.querySelector('.embed-web')).not.toBeNull()
    expect(view.contentDOM.textContent).not.toContain('<iframe')
  })
})
