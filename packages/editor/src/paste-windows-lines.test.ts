// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { parsed } from '../test/parsed'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { pasteHere, pastePlain, richPaste } from './paste'
import { plainly } from './paste-place'

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

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        richPaste(),
      ],
    }),
  )
}

function viewOf(doc: string, at: number): EditorView {
  const view = new EditorView({
    state: stateOf(doc, at),
    parent: document.body,
  })
  open.push(view)
  return view
}

function keyPaste(view: EditorView, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (type: string) => (type === 'text/plain' ? text : '') },
  })
  view.contentDOM.dispatchEvent(event)
}

describe('edit28 plain text with Windows line ends pasted through the editor’s own paste', () => {
  test('a list from Notepad pasted onto an empty item at the end of the note lands', async () => {
    const view = viewOf('Groceries\n\n- ', 'Groceries\n\n- '.length)
    const failed: unknown[] = []
    const catcher = (reason: unknown) => failed.push(reason)
    process.on('unhandledRejection', catcher)

    keyPaste(view, '- milk\r\n- eggs')
    await new Promise((done) => setTimeout(done, 30))
    process.off('unhandledRejection', catcher)

    expect(failed).toEqual([])
    expect(view.state.doc.toString()).toBe('Groceries\n\n- milk\n- eggs')
  })

  test('the caret ends right after the pasted list, not past it', () => {
    const doc = '- \n\nafter'
    const state = stateOf(doc, 2)
    const next = state.update(plainly(state, '- milk\r\n- eggs\r\n- bread')).state

    expect(next.doc.toString()).toBe('- milk\n- eggs\n- bread\n\nafter')
    expect(next.selection.main.head).toBe('- milk\n- eggs\n- bread'.length)
  })

  test('Edit > Paste of plain lines leaves the caret at their end', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        read: () => Promise.reject(new Error('refused')),
        readText: () => Promise.resolve('one\r\ntwo\r\nthree'),
      },
    })
    const view = viewOf('start  end', 'start '.length)

    pasteHere(view)
    await vi.waitFor(() => expect(view.state.doc.toString()).not.toBe('start  end'))

    expect(view.state.doc.toString()).toBe('start one\ntwo\nthree end')
    expect(view.state.selection.main.head).toBe('start one\ntwo\nthree'.length)
  })

  test('Paste as plain text at the end of the note writes the lines', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { readText: () => Promise.resolve('one\r\ntwo') },
    })
    const view = viewOf('Notes: ', 'Notes: '.length)
    const failed: unknown[] = []
    const catcher = (reason: unknown) => failed.push(reason)
    process.on('unhandledRejection', catcher)

    pastePlain(view)
    await new Promise((done) => setTimeout(done, 30))
    process.off('unhandledRejection', catcher)

    expect(failed).toEqual([])
    expect(view.state.doc.toString()).toBe('Notes: one\ntwo')
  })
})
