// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor, editorState } from './editor'
import { HeldState } from './held'
import { setReadOnlyMode } from './modes'
import { SharedDoc } from './shared'

const NOTE = '# Shared\n\nwords a guest may only read\n'
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function typed(view: EditorView, words: string) {
  const at = view.state.doc.length
  view.dispatch({
    changes: { from: at, insert: words },
    selection: { anchor: at + words.length },
    userEvent: 'input.type',
  })
}
describe('a note made read-only from the start', () => {
  test('refuses typing from its first frame, and its shared words never change', () => {
    const note = new SharedDoc(NOTE)
    const view = createEditor({ parent: document.body, shared: note, readOnly: true })
    open.push(view)
    expect(view.state.readOnly).toBe(true)
    typed(view, 'x')
    expect(view.state.doc.toString()).toBe(NOTE)
    expect(note.text.toString()).toBe(NOTE)
  })
  test('stays read-only when its state is handed to an editor later', () => {
    const note = new SharedDoc(NOTE)
    const view = createEditor({ parent: document.body, doc: '' })
    open.push(view)
    HeldState.waiting(note, editorState({ shared: note, readOnly: true })).give(view)
    typed(view, 'x')
    expect(note.text.toString()).toBe(NOTE)
  })
  test('still shows what the owner writes', () => {
    const note = new SharedDoc(NOTE)
    const view = createEditor({ parent: document.body, shared: note, readOnly: true })
    open.push(view)
    note.arrived([{ from: NOTE.length, to: NOTE.length, insert: 'more\n' }])
    expect(view.state.doc.toString()).toBe(`${NOTE}more\n`)
  })
  test('takes typing once it may be written', () => {
    const note = new SharedDoc(NOTE)
    const view = createEditor({ parent: document.body, shared: note, readOnly: true })
    open.push(view)
    setReadOnlyMode(view, false)
    typed(view, 'x')
    expect(note.text.toString()).toBe(`${NOTE}x`)
  })
  test('an editor made without saying is written as before', () => {
    const note = new SharedDoc(NOTE)
    const view = createEditor({ parent: document.body, shared: note })
    open.push(view)
    typed(view, 'x')
    expect(note.text.toString()).toBe(`${NOTE}x`)
  })
})
