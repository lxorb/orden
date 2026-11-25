// @vitest-environment jsdom
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { undoEdit } from '../shared'
import { keptViews } from '../../test/views'

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'
const open = keptViews()
function editor(doc: string, caret: number): EditorView {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: caret } })
  open.push(view)
  ensureSyntaxTree(view.state, doc.length, 10_000)
  view.dispatch({ selection: { anchor: caret }, userEvent: 'select' })
  return view
}
function press(view: EditorView, key: string) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor')
}
function tables(view: EditorView): string[] {
  const { state } = view
  ensureSyntaxTree(state, state.doc.length, 10_000)
  const found: string[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') found.push(state.doc.sliceString(node.from, node.to))
    },
  })
  return found
}
const text = (view: EditorView) => view.state.doc.toString()
describe('words beside a table stay out of it', () => {
  const doc = `above\n\n${TABLE}\n\nbelow`
  test('Backspace at the start of the paragraph under a table', () => {
    const view = editor(doc, doc.indexOf('below'))
    press(view, 'Backspace')
    press(view, 'Backspace')
    expect(text(view)).toBe(doc)
    expect(tables(view)).toEqual([TABLE])
  })
  test('Delete on the blank line under a table', () => {
    const view = editor(doc, doc.indexOf('below') - 1)
    press(view, 'Delete')
    expect(tables(view)).toEqual([TABLE])
    expect(text(view)).toContain('below')
  })
  test('Delete at the end of the paragraph above a table', () => {
    const view = editor(doc, 'above'.length)
    press(view, 'Delete')
    press(view, 'Delete')
    expect(text(view)).toBe(`above\n${TABLE}\n\nbelow`)
    expect(tables(view)).toEqual([TABLE])
  })
  test('words typed on the line right under a table', () => {
    const start = `${TABLE}\n`
    const view = editor(start, start.length)
    view.dispatch({
      changes: { from: start.length, insert: 'h' },
      selection: { anchor: start.length + 1 },
      userEvent: 'input.type',
    })
    expect(text(view)).toBe(`${TABLE}\n\nh`)
    expect(tables(view)).toEqual([TABLE])
    expect(view.state.selection.main.head).toBe(text(view).length)
  })
  test('words typed on the line right above a table leave it whole', () => {
    const start = `\n${TABLE}`
    const view = editor(start, 0)
    view.dispatch({ changes: { from: 0, insert: 'h' }, selection: { anchor: 1 }, userEvent: 'input.type' })
    expect(text(view)).toBe(`h\n${TABLE}`)
    expect(tables(view)).toEqual([TABLE])
    expect(view.state.selection.main.head).toBe(1)
  })
  test('a selection deleted between a paragraph and a table', () => {
    const start = `above\n\ngone\n\n${TABLE}\n\ngone\n\nbelow`
    const view = editor(start, 0)
    const from = start.lastIndexOf('\n\ngone')
    view.dispatch({ changes: { from, to: start.indexOf('below') }, userEvent: 'delete.selection' })
    const upper = text(view).indexOf('\ngone')
    view.dispatch({ changes: { from: upper, to: text(view).indexOf('|') }, userEvent: 'delete.selection' })
    expect(tables(view)).toEqual([TABLE])
    expect(text(view)).toBe(`above\n${TABLE}\n\nbelow`)
  })
  test('words pasted at the end of a table', () => {
    const start = `${TABLE}\n\nbelow`
    const view = editor(start, start.length)
    view.dispatch({ changes: { from: TABLE.length, insert: '\npasted words' }, userEvent: 'input.paste' })
    expect(tables(view)).toEqual([TABLE])
    expect(text(view)).toBe(`${TABLE}\n\npasted words\n\nbelow`)
  })
  test('undo takes the kept line back with the edit', () => {
    const start = `${TABLE}\n`
    const view = editor(start, start.length)
    view.dispatch({
      changes: { from: start.length, insert: 'h' },
      selection: { anchor: start.length + 1 },
      userEvent: 'input.type',
    })
    undoEdit(view)
    expect(text(view)).toBe(start)
  })
})
describe('what is meant for the table still reaches it', () => {
  test('a row typed under a table joins it', () => {
    const start = `${TABLE}\n`
    const view = editor(start, start.length)
    view.dispatch({ changes: { from: start.length, insert: '| 3 | 4 |' }, userEvent: 'input.type' })
    expect(tables(view)).toEqual([`${TABLE}\n| 3 | 4 |`])
  })
  test('a heading under a table needs no blank line', () => {
    const start = `${TABLE}\n\n# head`
    const view = editor(start, start.indexOf('#') - 1)
    view.dispatch({ changes: { from: start.indexOf('#') - 1, to: start.indexOf('#') }, userEvent: 'delete.forward' })
    expect(text(view)).toBe(`${TABLE}\n# head`)
  })
  test('an edit from elsewhere is left as it came', () => {
    const start = `${TABLE}\n`
    const view = editor(start, 0)
    view.dispatch({ changes: { from: start.length, insert: 'h' } })
    expect(text(view)).toBe(`${TABLE}\nh`)
  })
})
