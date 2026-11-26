// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { undoEdit } from '../shared'
import { selectIn } from './caret'
import { keptViews } from '../../test/views'

const TABLE = '| a   | b   | c   |\n| --- | --- | --- |\n| 1   | 2   | 3   |\n| 4   | 5   | 6   |'
const DOC = `above\n\n${TABLE}\n\nend`
const open = keptViews()
let under: Element | null = null
beforeAll(() => {
  document.elementFromPoint = () => under
})
function editor(): EditorView {
  const view = createEditor({ parent: document.body, doc: DOC, selection: { anchor: 0 } })
  open.push(view)
  return view
}
function cell(view: EditorView, row: number, column: number): HTMLElement {
  const found = view.dom.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`)
  if (!found) throw new Error(`no cell at ${row}, ${column}`)
  found.tabIndex = 0
  return found
}
const picked = (view: EditorView) => [...view.dom.querySelectorAll('.is-picked')].map((one) => one.textContent)
const body = (view: EditorView) => view.state.doc.toString().split('\n').slice(4, 6)
function press(target: HTMLElement, key: string, held: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }))
}
function down(target: HTMLElement, held: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...held }))
}
function drag(view: EditorView, from: [number, number], to: [number, number]) {
  down(cell(view, ...from))
  under = cell(view, ...to)
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }))
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
}
function clipboard(target: HTMLElement, type: 'copy' | 'cut' | 'paste', given: Record<string, string> = {}) {
  const held = { ...given }
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (kind: string) => held[kind] ?? '',
      setData: (kind: string, text: string) => (held[kind] = text),
    },
  })
  target.dispatchEvent(event)
  return held
}
const focused = () => document.activeElement as HTMLElement
describe('selecting cells', () => {
  test('a drag from one cell into another selects the rectangle between them', () => {
    const view = editor()
    drag(view, [0, 0], [1, 1])
    expect(picked(view)).toEqual(['1', '2', '4', '5'])
    expect(view.dom.querySelector('.orden-table-wrap')?.classList.contains('is-picking')).toBe(true)
  })
  test('a press that never leaves its cell selects no cells', () => {
    const view = editor()
    drag(view, [0, 0], [0, 0])
    expect(picked(view)).toEqual([])
  })
  test('Shift and a click reach from the cell being written in', () => {
    const view = editor()
    down(cell(view, 0, 1))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    down(cell(view, -1, 2), { shiftKey: true })
    expect(picked(view)).toEqual(['b', 'c', '2', '3'])
  })
  test('Shift and an arrow past the end of a cell’s words start a range, further arrows grow it', () => {
    const view = editor()
    const first = cell(view, 0, 0)
    first.focus()
    selectIn(first, 0)
    press(first, 'ArrowRight', { shiftKey: true })
    expect(picked(view)).toEqual([])
    selectIn(first, 1)
    press(first, 'ArrowRight', { shiftKey: true })
    expect(picked(view)).toEqual(['1', '2'])
    cell(view, 0, 1)
    press(focused(), 'ArrowDown', { shiftKey: true })
    expect(picked(view)).toEqual(['1', '2', '4', '5'])
  })
  test('Select all takes the cell’s words, then the table, then the note', () => {
    const view = editor()
    const first = cell(view, 0, 0)
    first.focus()
    selectIn(first, 0)
    press(first, 'a', { ctrlKey: true })
    expect(picked(view)).toEqual([])
    expect(String(getSelection())).toBe('1')
    press(first, 'a', { ctrlKey: true })
    expect(picked(view)).toHaveLength(9)
    cell(view, 1, 2)
    press(cell(view, 1, 2), 'a', { ctrlKey: true })
    expect(picked(view)).toEqual([])
    expect(view.state.selection.main).toMatchObject({ from: 0, to: DOC.length })
  })
  test('Escape or a plain arrow goes back to a caret', () => {
    const view = editor()
    drag(view, [0, 0], [1, 1])
    press(cell(view, 1, 1), 'Escape')
    expect(picked(view)).toEqual([])
    drag(view, [0, 0], [1, 1])
    press(cell(view, 1, 1), 'ArrowLeft')
    expect(picked(view)).toEqual([])
    expect(view.state.doc.toString()).toBe(DOC)
  })
})
describe('with cells selected', () => {
  test('copy gives a grid and leaves the table as it is', () => {
    const view = editor()
    drag(view, [0, 0], [1, 1])
    const held = clipboard(cell(view, 1, 1), 'copy')
    expect(held['text/plain']).toBe('1\t2\n4\t5')
    expect(held['text/html']).toBe('<table><tr><td>1</td><td>2</td></tr><tr><td>4</td><td>5</td></tr></table>')
    expect(view.state.doc.toString()).toBe(DOC)
  })
  test('cut gives the grid and empties the cells, in one step', () => {
    const view = editor()
    drag(view, [0, 1], [1, 2])
    expect(clipboard(cell(view, 1, 2), 'cut')['text/plain']).toBe('2\t3\n5\t6')
    expect(body(view)).toEqual(['| 1   |     |     |', '| 4   |     |     |'])
    undoEdit(view)
    expect(view.state.doc.toString()).toBe(DOC)
  })
  test.each(['Backspace', 'Delete'])('%s empties them and keeps them selected', (key) => {
    const view = editor()
    drag(view, [0, 0], [0, 2])
    press(cell(view, 0, 2), key)
    expect(body(view)).toEqual(['|     |     |     |', '| 4   | 5   | 6   |'])
    expect(picked(view)).toHaveLength(3)
  })
  test('pasted words fill every selected cell', () => {
    const view = editor()
    drag(view, [0, 0], [1, 0])
    clipboard(cell(view, 1, 0), 'paste', { 'text/plain': 'same' })
    expect(body(view)).toEqual(['| same | 2   | 3   |', '| same | 5   | 6   |'])
  })
  test('a pasted grid starts at the first selected cell', async () => {
    const view = editor()
    drag(view, [1, 2], [0, 1])
    clipboard(cell(view, 0, 1), 'paste', { 'text/plain': 'x\ty' })
    await expect.poll(() => body(view)).toEqual(['| 1   | x   | y   |', '| 4   | 5   | 6   |'])
  })
  test('a selection made while a cell held unsaved words keeps those words', () => {
    const view = editor()
    const first = cell(view, 0, 0)
    first.focus()
    first.textContent = '1 typed'
    first.dispatchEvent(new InputEvent('input', { bubbles: true }))
    drag(view, [0, 1], [1, 1])
    expect(view.state.doc.toString()).toContain('| 1 typed |')
    expect(picked(view)).toEqual(['2', '5'])
  })
})
describe('a selection of the note that runs over a table', () => {
  test('leaves the table drawn and shows it selected', () => {
    const view = editor()
    view.dispatch({ selection: { anchor: 0, head: DOC.length }, userEvent: 'select' })
    const wrap = view.dom.querySelector('.orden-table-wrap')
    expect(wrap?.querySelector('table.orden-table')).not.toBeNull()
    expect(wrap?.classList.contains('is-covered')).toBe(true)
    view.dispatch({ selection: { anchor: 0 }, userEvent: 'select' })
    expect(view.dom.querySelector('.orden-table-wrap')?.classList.contains('is-covered')).toBe(false)
  })
  test('a caret put into its text still shows the text', () => {
    const view = editor()
    view.dispatch({ selection: { anchor: DOC.indexOf('| a') + 2 }, userEvent: 'select' })
    expect(view.dom.querySelector('table.orden-table')).toBeNull()
  })
})
