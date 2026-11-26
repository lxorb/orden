// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { undoEdit } from '../shared'
import { insertTableToEdit } from './keymap'
import { renderInline } from './inline'
import { keptViews } from '../../test/views'

const open = keptViews()
function editor(doc: string, caret = doc.length): EditorView {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: caret } })
  open.push(view)
  ensureSyntaxTree(view.state, doc.length, 10_000)
  view.dispatch({ selection: { anchor: caret }, userEvent: 'select' })
  return view
}
const enter = (view: EditorView) => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
describe('a typed row of pipes and Enter', () => {
  test('become a table with an empty row to write in', () => {
    const view = editor('words\n\n| Name | Size |')
    expect(enter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('words\n\n| Name | Size |\n| ---- | ---- |\n|      |      |\n\n')
    expect(view.dom.querySelectorAll('.orden-table th')).toHaveLength(2)
  })
  test('keep the words under them apart', () => {
    const doc = '| a | b |\n# next'
    const view = editor(doc, '| a | b |'.length)
    enter(view)
    expect(view.state.doc.toString()).toBe('| a   | b   |\n| --- | --- |\n|     |     |\n\n# next')
  })
  test('are one step for undo', () => {
    const view = editor('| a | b |')
    enter(view)
    undoEdit(view)
    expect(view.state.doc.toString()).toBe('| a | b |')
  })
  test.each([
    ['in the middle of the row', '| a | b |', 3],
    ['with no words between the pipes', '| | |', 5],
    ['with no closing pipe', '| a | b', 7],
    ['inside a table already', '| a | b |\n| - | - |\n| 1 | 2 |', 29],
    ['in a code block', '```\n| a | b |\n```', 13],
    ['in a list item', '- | a | b |', 11],
  ])('%s Enter stays Enter', (_what, doc, caret) => {
    const view = editor(doc, caret)
    enter(view)
    expect(view.dom.querySelectorAll('.orden-table tbody tr[data-row]').length).toBeLessThan(
      doc.includes('- |') ? 2 : 1,
    )
    expect(view.state.doc.toString()).not.toContain('|     |')
  })
})
describe('a new table', () => {
  test('is three columns by two rows with nothing in its header', () => {
    const view = editor('words')
    insertTableToEdit(view)
    expect(view.state.doc.toString()).toContain(
      '|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |',
    )
    expect(view.state.doc.toString()).not.toContain('Column')
  })
})
describe('a cell', () => {
  function typed(view: EditorView, key: KeyboardEventInit) {
    const cell = view.dom.querySelector<HTMLElement>('td')
    if (!cell) throw new Error('no cell')
    cell.tabIndex = 0
    cell.focus()
    cell.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...key }))
  }
  test('takes a line break on Shift and Enter', () => {
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    const view = editor('| a |\n| --- |\n| one |\n\nend')
    typed(view, { key: 'Enter', shiftKey: true })
    expect(view.state.doc.toString()).toContain('<br>')
    expect(view.state.doc.toString().split('\n')).toHaveLength(5)
  })
  test('draws that break as a new line', () => {
    const host = document.createElement('div')
    host.append(renderInline('one<br>two<BR/>three'))
    expect(host.innerHTML).toBe('one<br>two<br>three')
  })
})
describe('a column border', () => {
  test('pressed twice lets the column fit again', () => {
    const view = editor('| a | b |\n| --- | --- |\n| 1 | 2 | <!-- orden:widths 200,150 -->\n\nend')
    const grips = view.dom.querySelectorAll('.orden-table-resize')
    grips[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(view.state.doc.toString()).toContain('<!-- orden:widths -,150 -->')
    view.dom.querySelectorAll('.orden-table-resize')[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(view.state.doc.toString()).not.toContain('orden:widths')
  })
})
