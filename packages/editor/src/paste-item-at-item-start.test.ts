// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { copiedFlavours, readyToCopy } from './copy'
import { editorState } from './editor'
import { loadLineCommands } from './line-door'

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await import('@orden/markdown/from-html')
  await loadLineCommands()
  await readyToCopy()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function viewOf(doc: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  return view
}
function copiedLine(view: EditorView, line: string): { text: string; html: string } {
  const from = view.state.doc.toString().indexOf(line)
  view.dispatch({ selection: EditorSelection.range(from, from + line.length + 1) })
  const flavours = copiedFlavours(view.state)
  return { text: flavours?.text ?? '', html: flavours?.html ?? '' }
}
function clickedBefore(view: EditorView, words: string) {
  const at = view.state.doc.toString().indexOf(words)
  view.dispatch({ selection: EditorSelection.cursor(at), userEvent: 'select.pointer' })
}
async function pasted(view: EditorView, copied: { text: string; html: string }) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      types: ['text/plain', 'text/html'],
      getData: (type: string) => (type === 'text/plain' ? copied.text : type === 'text/html' ? copied.html : ''),
    },
  })
  view.contentDOM.dispatchEvent(event)
  await new Promise((done) => setTimeout(done, 30))
}
describe('a whole item line copied in Orden and pasted at the start of another item', () => {
  test('a bullet lands as its own item above, and the item keeps its bullet', async () => {
    const view = viewOf('- milk\n- eggs\n- bread\n\nend')
    const copied = copiedLine(view, '- bread')
    clickedBefore(view, 'milk')
    await pasted(view, copied)
    expect(view.state.doc.toString()).toBe('- bread\n- milk\n- eggs\n- bread\n\nend')
  })
  test('a task lands as its own task above, and the task keeps its box', async () => {
    const view = viewOf('- [ ] milk\n- [ ] eggs\n\nend')
    const copied = copiedLine(view, '- [ ] eggs')
    clickedBefore(view, 'milk')
    await pasted(view, copied)
    expect(view.state.doc.toString()).toBe('- [ ] eggs\n- [ ] milk\n- [ ] eggs\n\nend')
  })
  test('a numbered item lands as its own item above', async () => {
    const view = viewOf('1. milk\n2. eggs\n\nend')
    const copied = copiedLine(view, '2. eggs')
    clickedBefore(view, 'milk')
    await pasted(view, copied)
    expect(view.state.doc.line(2).text).toBe('1. milk')
  })
})
