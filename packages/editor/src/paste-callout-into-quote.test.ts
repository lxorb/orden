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

function copiedLines(view: EditorView, lines: string): { text: string; html: string } {
  const from = view.state.doc.toString().indexOf(lines)
  view.dispatch({ selection: EditorSelection.range(from, from + lines.length + 1) })
  const flavours = copiedFlavours(view.state)
  return { text: flavours?.text ?? '', html: flavours?.html ?? '' }
}

function caretAt(view: EditorView, words: string) {
  const at = view.state.doc.toString().indexOf(words)
  view.dispatch({ selection: EditorSelection.cursor(at), userEvent: 'select' })
}

async function pasted(view: EditorView, copied: { text: string; html: string }) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      types: ['text/plain', 'text/html'],
      getData: (type: string) =>
        type === 'text/plain' ? copied.text : type === 'text/html' ? copied.html : '',
    },
  })
  view.contentDOM.dispatchEvent(event)
  await new Promise((done) => setTimeout(done, 30))
}

describe('a whole callout copied in Orden and pasted at the start of words in a quote', () => {
  const doc =
    '> [!tip] Packing\n> Bring a coat.\n\n> Call the bank first.\n> Then pay the rent.\n\nafter'

  test('the plain quote does not turn into the pasted callout', async () => {
    const view = viewOf(doc)
    const copied = copiedLines(view, '> [!tip] Packing\n> Bring a coat.')
    caretAt(view, 'Call the bank')
    await pasted(view, copied)
    const lines = view.state.doc.toString().split('\n')
    const first = lines.findIndex((one) => one.includes('Call the bank'))
    let opening = first - 1
    while (opening >= 0 && lines[opening]?.startsWith('>')) opening--
    expect(lines[opening + 1]).not.toMatch(/^> \[!tip\]/)
  })

  test('a callout pasted into another callout is not left as a literal [!tip] line', async () => {
    const view = viewOf('> [!note] Plans\n> Call the bank first.\n\n' + doc)
    const copied = copiedLines(view, '> [!tip] Packing\n> Bring a coat.')
    caretAt(view, 'Call the bank')
    await pasted(view, copied)
    const text = view.state.doc.toString()
    expect(text.split('\n').filter((one) => one.startsWith('> [!tip]'))).toHaveLength(1)
  })
})
