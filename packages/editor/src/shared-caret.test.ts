// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from './editor'
import { type Caret, letGo, SharedDoc, undoEdit } from './shared'

const NOTE = '# Title\n\nwords'
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function shown(note: SharedDoc, at = 0): { view: EditorView; heard: Caret[] } {
  const view = createEditor({ parent: document.body, shared: note, selection: { anchor: at } })
  open.push(view)
  const heard: Caret[] = []
  note.caret((caret) => heard.push(caret))
  return { view, heard }
}
const settled = () => new Promise((done) => setTimeout(done, 40))
describe('a shared note tells where its caret is', () => {
  test('typing is told as typed, with the caret after the letter', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 7)
    view.dispatch({ changes: { from: 7, insert: 's' }, selection: { anchor: 8 }, userEvent: 'input.type' })
    expect(heard.at(-1)).toMatchObject({ head: 8, typed: true })
    expect(note.text.toString()).toBe('# Titles\n\nwords')
  })
  test('moving the caret is told as not typed', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 7)
    view.dispatch({ selection: { anchor: 12 }, userEvent: 'select' })
    expect(heard).toEqual([{ head: 12, focused: false, typed: false }])
  })
  test('focus and blur are told', async () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 7)
    view.focus()
    await settled()
    expect(heard.at(-1)).toMatchObject({ head: 7, focused: true, typed: false })
    view.contentDOM.blur()
    await settled()
    expect(heard.at(-1)).toMatchObject({ head: 7, focused: false, typed: false })
  })
  test('an undo in the editor is told as typed', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 7)
    view.dispatch({ changes: { from: 7, insert: 's' }, selection: { anchor: 8 }, userEvent: 'input.type' })
    heard.length = 0
    undoEdit(view)
    expect(heard).toEqual([{ head: 7, focused: false, typed: true }])
  })
  test('the editor letting go of the note is told as unfocused', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 7)
    view.dispatch({ selection: { anchor: 3 }, userEvent: 'select' })
    letGo(view)
    expect(heard.at(-1)).toEqual({ head: 3, focused: false, typed: false })
  })
  test('the editor showing another note is told as unfocused on the one it left', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 5)
    new SharedDoc('other').join(view)
    expect(heard).toEqual([{ head: 5, focused: false, typed: false }])
  })
  test('a view handed over is told as unfocused', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 4)
    const taking = createEditor({ parent: document.body, doc: NOTE })
    open.push(taking)
    note.handOver(view, taking, () => undefined)
    expect(heard).toEqual([{ head: 4, focused: false, typed: false }])
  })
  test('words from outside or from the room are not told', () => {
    const note = new SharedDoc(NOTE)
    const { heard } = shown(note, 7)
    note.replace('# Other\n\nwords')
    note.arrived([{ from: 0, to: 0, insert: 'x' }])
    note.takeOn('fresh')
    expect(heard).toEqual([])
  })
  test('every listener hears, and one that stopped hears no more', () => {
    const note = new SharedDoc(NOTE)
    const { view, heard } = shown(note, 7)
    const other: Caret[] = []
    const stop = note.caret((caret) => other.push(caret))
    view.dispatch({ selection: { anchor: 2 }, userEvent: 'select' })
    stop()
    view.dispatch({ selection: { anchor: 3 }, userEvent: 'select' })
    expect(other).toEqual([{ head: 2, focused: false, typed: false }])
    expect(heard).toHaveLength(2)
  })
})
