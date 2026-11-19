// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'
import { setQuietMarks } from './modes'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function quietView(doc: string, at: number) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: at } })
  open.push(view)
  setQuietMarks(view, true)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return view
}
function press(view: EditorView, key: string, ctrlKey = false) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey }), 'editor')
}
function type(view: EditorView, words: string) {
  for (const character of words) {
    const at = view.state.selection.main.head
    view.dispatch({
      changes: { from: at, insert: character },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    })
  }
}
describe('with marks out of sight, Backspace on the one space between two marked words', () => {
  test('keeps a bold word and the italic word after it', () => {
    const doc = '**one** *two*'
    const view = quietView(doc, doc.indexOf('two'))
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('**one***two*')
  })
  test('keeps a bold word and the code after it', () => {
    const doc = 'a **bold** `code` z'
    const view = quietView(doc, doc.indexOf('code'))
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('a **bold**`code` z')
  })
  test('Delete at the end of the bold word keeps both as well', () => {
    const doc = 'a **bold** `code` z'
    const view = quietView(doc, doc.indexOf('** `'))
    press(view, 'Delete')
    expect(view.state.doc.toString()).toBe('a **bold**`code` z')
  })
})
describe('with marks out of sight, Ctrl+Backspace inside a marked run', () => {
  test('a word made bold with Mod-B and taken back leaves no stray stars', () => {
    const doc = 'Buy '
    const view = quietView(doc, doc.length)
    press(view, 'b', true)
    type(view, 'milk')
    expect(view.state.doc.toString()).toBe('Buy **milk**')
    press(view, 'Backspace', true)
    expect(view.state.doc.toString()).toBe('Buy ')
  })
  test('taking the last of several bold words keeps the rest bold', () => {
    const doc = 'one **two three** z'
    const view = quietView(doc, doc.indexOf('**', 5))
    press(view, 'Backspace', true)
    expect(view.state.doc.toString()).toBe('one **two** z')
  })
  test('at the start of a bold word deletes the word before, not the hidden stars', () => {
    const doc = 'one **two** z'
    const view = quietView(doc, doc.indexOf('two'))
    press(view, 'Backspace', true)
    expect(view.state.doc.toString()).toBe('**two** z')
  })
  test('inside the first word of an underscore italic keeps its hidden underscore', () => {
    const doc = 'one _two three_ z'
    const view = quietView(doc, doc.indexOf('wo'))
    press(view, 'Backspace', true)
    expect(view.state.doc.toString()).toBe('one _wo three_ z')
  })
})
describe('with marks out of sight, Ctrl+Delete inside a marked run', () => {
  test('at the end of a bold word deletes the word after, not the hidden stars', () => {
    const doc = 'one **two** z'
    const view = quietView(doc, doc.indexOf('** z'))
    press(view, 'Delete', true)
    expect(view.state.doc.toString()).toBe('one **two**')
  })
  test('inside the last word of an underscore italic keeps its hidden underscore', () => {
    const doc = 'one _two three_ z'
    const view = quietView(doc, doc.indexOf('ee_'))
    press(view, 'Delete', true)
    expect(view.state.doc.toString()).toBe('one _two thr_ z')
  })
})
