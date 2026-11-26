// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { undoEdit } from '../shared'
import { tableMenuAt } from './widget'
import { keptViews } from '../../test/views'

const DOC = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |\n\nend'
const open = keptViews()
function editor(doc = DOC, readOnly = false): EditorView {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length }, readOnly })
  open.push(view)
  return view
}
const cell = (view: EditorView, row: number, column: number) =>
  view.dom.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`)
const labels = (_view: EditorView, target: Element | null) =>
  tableMenuAt(target)?.entries.map((one) => one?.label ?? '-') ?? []
function choose(_view: EditorView, target: Element | null, label: string) {
  const entry = tableMenuAt(target)?.entries.find((one) => one?.label === label)
  if (!entry) throw new Error(`the menu has no ${label}`)
  if (entry.disabled) throw new Error(`${label} is switched off`)
  entry.run()
}
const table = (view: EditorView) => view.state.doc.toString().split('\n\n')[0]?.split('\n') ?? []
describe('the menu of a cell', () => {
  test('lists the table’s own actions', () => {
    const view = editor()
    expect(labels(view, cell(view, 0, 0))).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      '-',
      'Align left',
      'Align centre',
      'Align right',
      '-',
      'Sort ascending',
      'Sort descending',
      '-',
      'Delete row',
      'Delete column',
    ])
  })
  test.each([
    ['Insert row above', ['| a   | b   |', '| --- | --- |', '|     |     |', '| 1   | 2   |', '| 3   | 4   |']],
    ['Insert row below', ['| a   | b   |', '| --- | --- |', '| 1   | 2   |', '|     |     |', '| 3   | 4   |']],
    [
      'Insert column left',
      ['|     | a   | b   |', '| --- | --- | --- |', '|     | 1   | 2   |', '|     | 3   | 4   |'],
    ],
    [
      'Insert column right',
      ['| a   |     | b   |', '| --- | --- | --- |', '| 1   |     | 2   |', '| 3   |     | 4   |'],
    ],
    ['Delete row', ['| a   | b   |', '| --- | --- |', '| 3   | 4   |']],
    ['Delete column', ['| b   |', '| --- |', '| 2   |', '| 4   |']],
    ['Align right', ['| a   | b   |', '| --: | --- |', '| 1   | 2   |', '| 3   | 4   |']],
  ])('%s does that, in one step that undo takes back', (label, wanted) => {
    const view = editor()
    choose(view, cell(view, 0, 0), label)
    expect(table(view)).toEqual(wanted)
    undoEdit(view)
    expect(view.state.doc.toString()).toBe(DOC)
  })
  test('ticks the alignment a column has and takes it off again', () => {
    const view = editor()
    choose(view, cell(view, 0, 1), 'Align centre')
    const ticked = tableMenuAt(cell(view, 1, 1))
      ?.entries.filter((one) => one?.checked)
      .map((one) => one?.label)
    expect(ticked).toEqual(['Align centre'])
    choose(view, cell(view, 0, 1), 'Align centre')
    expect(table(view)[1]).toBe('| --- | --- |')
  })
  test('cannot delete the header row or the last column', () => {
    const view = editor('| a |\n| --- |\n| 1 |\n\nend')
    const off = (target: Element | null) =>
      tableMenuAt(target)
        ?.entries.filter((one) => one?.disabled)
        .map((one) => one?.label)
    expect(off(cell(view, -1, 0))).toEqual([
      'Insert row above',
      'Sort ascending',
      'Sort descending',
      'Delete row',
      'Delete column',
    ])
  })
  test('is not offered in a note that cannot be written', () => {
    const view = editor(DOC, true)
    expect(tableMenuAt(cell(view, 0, 0))).toBeNull()
  })
})
describe('the grips', () => {
  function over(view: EditorView, row: number, column: number) {
    const moved = new MouseEvent('pointermove', { bubbles: true })
    Object.defineProperty(moved, 'pointerType', { value: 'mouse' })
    cell(view, row, column)?.dispatchEvent(moved)
  }
  function tap(grip: Element | null, pointerType = 'mouse') {
    for (const [type, target] of [
      ['pointerdown', grip],
      ['pointerup', document],
    ] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      target?.dispatchEvent(event)
    }
  }
  test('stand for the row and the column under the pointer', () => {
    const view = editor()
    over(view, 1, 1)
    const row = view.dom.querySelector('.orden-table-grip-row')
    const column = view.dom.querySelector('.orden-table-grip-column')
    expect(row?.classList.contains('is-shown')).toBe(true)
    expect(column?.classList.contains('is-shown')).toBe(true)
    expect(labels(view, row)).toContain('Duplicate row')
    expect(labels(view, column)).toContain('Duplicate column')
    choose(view, row, 'Duplicate row')
    expect(table(view).slice(2)).toEqual(['| 1   | 2   |', '| 3   | 4   |', '| 3   | 4   |'])
    over(view, 0, 1)
    choose(view, view.dom.querySelector('.orden-table-grip-column'), 'Clear column')
    expect(table(view).slice(0, 3)).toEqual(['| a   |     |', '| --- | --- |', '| 1   |     |'])
  })
  test('show no row grip for the header, which cannot move', () => {
    const view = editor()
    over(view, -1, 0)
    expect(view.dom.querySelector('.orden-table-grip-row')?.classList.contains('is-shown')).toBe(false)
    expect(view.dom.querySelector('.orden-table-grip-column')?.classList.contains('is-shown')).toBe(true)
  })
  test.each(['mouse', 'touch'])('a %s press selects the row and asks for its menu', (pointerType) => {
    const view = editor()
    over(view, 0, 0)
    const asked: EventTarget[] = []
    view.dom.addEventListener('contextmenu', (event) => {
      if (event.target) asked.push(event.target)
    })
    const grip = view.dom.querySelector('.orden-table-grip-row')
    tap(grip, pointerType)
    expect(asked).toEqual([grip])
    expect([...view.dom.querySelectorAll('.is-picked')].map((one) => one.textContent)).toEqual(['1', '2'])
  })
  test('the bars under and beside the table add a row and a column', () => {
    const view = editor()
    const press = (selector: string) =>
      view.dom.querySelector(selector)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    press('.orden-table-add-row')
    expect(table(view)).toHaveLength(5)
    press('.orden-table-add-column')
    expect(table(view)[0]).toBe('| a   | b   |     |')
  })
  test('are not drawn for a finger passing over', () => {
    const view = editor()
    const moved = new MouseEvent('pointermove', { bubbles: true })
    Object.defineProperty(moved, 'pointerType', { value: 'touch' })
    cell(view, 0, 0)?.dispatchEvent(moved)
    expect(view.dom.querySelector('.orden-table-grip.is-shown')).toBeNull()
  })
})
