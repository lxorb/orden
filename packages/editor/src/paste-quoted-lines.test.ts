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
      getData: (type: string) => (type === 'text/plain' ? copied.text : type === 'text/html' ? copied.html : ''),
    },
  })
  view.contentDOM.dispatchEvent(event)
  await new Promise((done) => setTimeout(done, 30))
}

describe('a whole quoted line copied in Orden and pasted at the start of words in the same quote', () => {
  test('a callout line stays at the depth of the callout', async () => {
    const view = viewOf('> [!note] Steps\n> Step one.\n> Step two.\n\nafter')
    const copied = copiedLine(view, '> Step two.')
    caretAt(view, 'Step one.')
    await pasted(view, copied)
    const doc = view.state.doc.toString()
    expect(doc).not.toContain('> >')
    expect(doc.indexOf('Step two.')).toBeLessThan(doc.indexOf('Step one.'))
  })

  test('a quoted item stays at the depth of the quote', async () => {
    const view = viewOf('> - milk\n> - eggs\n>\n> Buy them today.\n\nafter')
    const copied = copiedLine(view, '> - eggs')
    caretAt(view, 'Buy them')
    await pasted(view, copied)
    expect(view.state.doc.toString()).not.toContain('> >')
  })

  test('a quoted heading line stays at the depth of the callout', async () => {
    const view = viewOf('> [!note] Plans\n> ## Monday\n> Call the bank.\n\nafter')
    const copied = copiedLine(view, '> ## Monday')
    caretAt(view, 'Call the bank.')
    await pasted(view, copied)
    expect(view.state.doc.toString()).not.toContain('> >')
  })
})
