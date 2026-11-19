// @vitest-environment jsdom
import { cursorLineBoundaryBackward } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { livePreview } from '.'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string, cursor: number) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), livePreview()],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}
describe('Home in a bullet item', () => {
  test('stops after the hidden bullet, where the words start', () => {
    const doc = 'intro\n\n- first item\n- second item\n\nend'
    const end = doc.indexOf('first item') + 'first item'.length
    const view = viewOf(doc, end)
    view.dispatch({ selection: EditorSelection.cursor(end), userEvent: 'select' })
    cursorLineBoundaryBackward(view)
    expect(view.state.selection.main.head).toBe(doc.indexOf('first item'))
  })
  test('stops after the hidden box of a task, where the words start', () => {
    const doc = 'intro\n\n- [ ] buy milk\n\nend'
    const end = doc.indexOf('buy milk') + 'buy milk'.length
    const view = viewOf(doc, end)
    view.dispatch({ selection: EditorSelection.cursor(end), userEvent: 'select' })
    cursorLineBoundaryBackward(view)
    expect(view.state.selection.main.head).toBeGreaterThan(doc.indexOf('- [ ]'))
  })
})
