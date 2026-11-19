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
function picked(view: EditorView, words: string) {
  const at = view.state.doc.toString().indexOf(words)
  view.dispatch({ selection: EditorSelection.range(at, at + words.length), userEvent: 'select' })
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
describe('a whole quoted item line copied in Orden and pasted over picked words of an item in the same quote', () => {
  test('keeps the item in the quote it was in, not a quote inside it', async () => {
    const view = viewOf('> - milk\n> - eggs\n> - bread\n\nend')
    const copied = copiedLine(view, '> - bread')
    picked(view, 'milk')
    await pasted(view, copied)
    expect(view.state.doc.toString()).toBe('> - bread\n> - eggs\n> - bread\n\nend')
  })
  test('keeps the item in its callout', async () => {
    const view = viewOf('> [!note] Shopping\n> - milk\n> - bread\n\nend')
    const copied = copiedLine(view, '> - bread')
    picked(view, 'milk')
    await pasted(view, copied)
    expect(view.state.doc.toString()).toBe('> [!note] Shopping\n> - bread\n> - bread\n\nend')
  })
})
