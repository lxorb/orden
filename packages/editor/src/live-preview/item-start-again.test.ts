// @vitest-environment jsdom
import { cursorLineBoundaryBackward } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { livePreview } from '.'
import { quietMarks } from './reveal'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string, cursor: number, quiet = false) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        livePreview(),
        quietMarks.of(quiet),
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  open.push(view)
  return view
}
describe('Home pressed again at the start of an item', () => {
  test('keeps the caret on the item line', () => {
    const doc = 'intro\n- first item\n- second item\n\nend'
    const start = doc.indexOf('second item')
    const view = viewOf(doc, start)
    cursorLineBoundaryBackward(view)
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(3).text).toBe('- xsecond item')
  })
  test('a click on the bullet with the caret already at the words keeps the caret there', () => {
    const doc = 'intro\n- first item\n- second item\n\nend'
    const start = doc.indexOf('second item')
    const view = viewOf(doc, start)
    const line = view.state.doc.line(3)
    view.dispatch({ selection: EditorSelection.cursor(line.from), userEvent: 'select.pointer' })
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(3).text).toBe('- xsecond item')
  })
  test('Home on a heading with quiet marks keeps the caret on the heading', () => {
    const doc = 'intro\n## Plan\n\nend'
    const start = doc.indexOf('Plan')
    const view = viewOf(doc, start, true)
    cursorLineBoundaryBackward(view)
    view.dispatch(view.state.replaceSelection('x'))
    expect(view.state.doc.line(2).text).toBe('## xPlan')
  })
})
describe('ArrowLeft from where the words of an item start', () => {
  test('goes to the end of the line above, not before the hidden bullet', () => {
    const doc = 'intro\n- first item\n- second item'
    const at = doc.indexOf('second')
    const view = viewOf(doc, at)
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 'editor')
    expect(view.state.selection.main.head).toBe(doc.indexOf('\n- second'))
  })
})
