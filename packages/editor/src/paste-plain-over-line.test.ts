// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { editorState } from './editor'
import { loadLineCommands } from './line-door'
import { pastePlain } from './paste'

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await import('@orden/markdown/from-html')
  await loadLineCommands()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
  vi.unstubAllGlobals()
})
function tripleClicked(doc: string, line: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  const from = doc.indexOf(line)
  view.dispatch({ selection: EditorSelection.range(from, from + line.length + 1) })
  return view
}
function keyPaste(view: EditorView, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  })
  view.contentDOM.dispatchEvent(event)
}
describe('edit31 plain text pasted over a line picked with a triple click', () => {
  test('Ctrl+V keeps the next line on its own line', async () => {
    const view = tripleClicked('- one\n- two\n- three', '- two')
    keyPaste(view, '- new')
    await new Promise((done) => setTimeout(done, 30))
    expect(view.state.doc.toString()).toBe('- one\n- new\n- three')
  })
  test('Paste as plain text keeps the next line on its own line', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve('New words.') } })
    const view = tripleClicked('Old words.\nNext line.', 'Old words.')
    pastePlain(view)
    await new Promise((done) => setTimeout(done, 30))
    expect(view.state.doc.toString()).toBe('New words.\nNext line.')
  })
})
