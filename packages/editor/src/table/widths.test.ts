// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { renderMarkdown } from '@orden/markdown'
import { describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { undoEdit } from '../shared'
import {
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  removeColumn,
  removeRow,
  serializeTable,
  setPixels,
  type TableModel,
} from './model'
import { sortRows } from './sort'
import { keptViews } from '../../test/views'

const NOTE = '<!-- orden:widths 240,-,120 -->'
const SOURCE = `| a | b | c |\n| --- | --- | --- |\n| 2 | x | y | ${NOTE}\n| 1 | z | w |`
const read = (source: string): TableModel => parseTable(source)!
const notes = (text: string) => text.match(/orden:widths/g)?.length ?? 0
const lines = (model: TableModel) => serializeTable(model).split('\n')
describe('the widths a table keeps', () => {
  test('are read from the note on a row and never shown in a cell', () => {
    const model = read(SOURCE)
    expect(model.pixels).toEqual([240, null, 120])
    expect(model.header).toHaveLength(3)
    expect(model.rows).toEqual([
      ['2', 'x', 'y'],
      ['1', 'z', 'w'],
    ])
  })
  test('are written once, after the first row', () => {
    expect(lines(read(SOURCE))).toEqual([
      '| a   | b   | c   |',
      '| --- | --- | --- |',
      `| 2   | x   | y   | ${NOTE}`,
      '| 1   | z   | w   |',
    ])
  })
  test('are not written for a table nobody resized', () => {
    const plain = read('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(plain.pixels).toBeUndefined()
    expect(serializeTable(plain)).not.toContain('orden:widths')
    expect(serializeTable(setPixels(setPixels(plain, 0, 90), 0, null))).not.toContain('orden:widths')
  })
  test('stand before a row’s own name', () => {
    const named = read(`| a | b |\n| - | - |\n| 1 | 2 | <!-- orden:widths 90,- --> ^first`)
    expect(named.pixels).toEqual([90, null])
    expect(named.names).toEqual(['first'])
    expect(lines(named)[2]).toBe('| 1   | 2   | <!-- orden:widths 90,- --> ^first')
  })
  test.each([
    ['of the wrong count', '<!-- orden:widths 240,120 -->'],
    ['that is broken', '<!-- orden:widths 240,abc,1e9 -->'],
    ['that is empty', '<!-- orden:widths -->'],
    ['of nothing but gaps', '<!-- orden:widths -,-,- -->'],
  ])('a note %s is dropped without a trace', (_what, note) => {
    const model = read(SOURCE.replace(NOTE, note))
    expect(model.pixels).toBeUndefined()
    expect(model.header).toHaveLength(3)
    expect(model.rows[0]).toEqual(['2', 'x', 'y'])
    expect(serializeTable(model)).not.toContain('orden:widths')
  })
  test('two notes become one', () => {
    const twice = read(`${SOURCE} <!-- orden:widths 50,60,70 -->`)
    expect(twice.pixels).toEqual([240, null, 120])
    expect(twice.rows[1]).toEqual(['1', 'z', 'w'])
    expect(notes(serializeTable(twice))).toBe(1)
  })
})
describe('the note follows the table through its edits', () => {
  const model = read(SOURCE)
  const onFirstRowOnly = (next: TableModel) => {
    const written = lines(next)
    expect(notes(serializeTable(next))).toBe(1)
    expect(written[2]).toContain('orden:widths')
    expect(read(serializeTable(next))).toEqual(next)
  }
  test('a sort', () => {
    const sorted = sortRows(model, 0, 'up')
    expect(sorted.rows[0]?.[0]).toBe('1')
    onFirstRowOnly(sorted)
  })
  test('the first row deleted', () => onFirstRowOnly(removeRow(model, 0)))
  test('a row moved', () => onFirstRowOnly(moveRow(model, 0, 1)))
  test('a row put first', () => onFirstRowOnly(insertRow(model, 0)))
  test('a column added, moved and removed', () => {
    expect(insertColumn(model, 1).pixels).toEqual([240, null, null, 120])
    expect(moveColumn(model, 0, 2).pixels).toEqual([null, 120, 240])
    expect(removeColumn(model, 0).pixels).toEqual([null, 120])
    onFirstRowOnly(insertColumn(model, 1))
    onFirstRowOnly(moveColumn(model, 0, 2))
    onFirstRowOnly(removeColumn(model, 0))
  })
  test('the last row deleted leaves no note behind', () => {
    const bare = removeRow(removeRow(model, 0), 0)
    expect(serializeTable(bare)).not.toContain('orden:widths')
  })
})
test('reading and export never show the note', () => {
  const drawn = renderMarkdown(`${SOURCE}\n`)
  expect(drawn).not.toContain('orden:widths')
  expect(drawn.match(/<td>/g)).toHaveLength(6)
})
describe('in the editor', () => {
  const open = keptViews()
  const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nend'
  function editor(text = doc): EditorView {
    const view = createEditor({ parent: document.body, doc: text, selection: { anchor: text.length } })
    open.push(view)
    forceParsing(view, text.length, 10_000)
    return view
  }
  function drag(view: EditorView, column: number, by: number) {
    const grip = view.dom.querySelectorAll<HTMLElement>('.orden-table-resize')[column]
    if (!grip) throw new Error('the table drew no resize grip')
    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true, cancelable: true }))
    if (by) document.dispatchEvent(new MouseEvent('mousemove', { clientX: by }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: by }))
  }
  const widthOf = (view: EditorView, column: number) =>
    view.dom.querySelectorAll<HTMLElement>('.orden-table th')[column]?.style.width
  test('a dragged border is written with the table and drawn from it', () => {
    const view = editor()
    drag(view, 1, 130)
    expect(view.state.doc.toString()).toContain('| 1   | 2   | <!-- orden:widths -,130 -->')
    expect(notes(view.state.doc.toString())).toBe(1)
    expect(widthOf(view, 1)).toBe('130px')
    const again = editor(view.state.doc.toString())
    expect(widthOf(again, 1)).toBe('130px')
    expect(again.dom.querySelector('.orden-table')?.textContent).not.toContain('orden')
  })
  test('a border pressed and not moved writes nothing', () => {
    const view = editor()
    drag(view, 0, 0)
    expect(view.state.doc.toString()).toBe(doc)
  })
  test('undo takes the width back', () => {
    const view = editor()
    drag(view, 0, 200)
    expect(notes(view.state.doc.toString())).toBe(1)
    undoEdit(view)
    expect(notes(view.state.doc.toString())).toBe(0)
    expect(widthOf(view, 0)).toBe('')
  })
  test('a width set by someone else is drawn here', () => {
    const view = editor()
    const at = view.state.doc.toString().indexOf('| 1 | 2 |') + '| 1 | 2 |'.length
    view.dispatch({ changes: { from: at, insert: ' <!-- orden:widths 180,- -->' } })
    expect(widthOf(view, 0)).toBe('180px')
    expect(view.dom.querySelector('.orden-table')?.textContent).not.toContain('orden')
  })
  test('a row they put first while a width is set here keeps one note', () => {
    const view = editor()
    drag(view, 0, 200)
    const text = view.state.doc.toString()
    const first = text.indexOf('| 1 ')
    view.dispatch({ changes: { from: first, insert: '| 0   | 0   |\n' } })
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '4')
    if (!cell) throw new Error('the table drew no cell holding 4')
    cell.tabIndex = 0
    cell.focus()
    cell.textContent = '4 and more than the column held'
    cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const after = view.state.doc.toString()
    expect(notes(after)).toBe(1)
    expect(after.split('\n')[2]).toContain('| 0')
    expect(after.split('\n')[2]).toContain('orden:widths 200,-')
    expect(widthOf(view, 0)).toBe('200px')
  })
})
