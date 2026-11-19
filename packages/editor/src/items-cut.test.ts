// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import { type EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { readyToCopy } from './copy'
import { createEditor } from './editor'
import { setSourceMode } from './modes'

const open: EditorView[] = []
beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await readyToCopy()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function picked(doc: string, from: number, to: number, source = false): EditorView {
  const view = createEditor({ parent: document.body, doc })
  open.push(view)
  if (source) setSourceMode(view, true)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: EditorSelection.range(from, to) })
  return view
}
const after = (doc: string, words: string) => doc.indexOf(words) + words.length
function cut(view: EditorView): string {
  const kept: Record<string, string> = {}
  const event = new Event('cut', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (type: string, value: string) => (kept[type] = value) },
  })
  view.contentDOM.dispatchEvent(event)
  return kept['text/plain'] ?? ''
}
function press(view: EditorView, key: string) {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor')
}
const LIST = 'intro\n\n- milk\n- eggs\n- tea\n\nend'
describe('cutting a selection that covers whole list items', () => {
  test('from the first item words to the end of the last item takes the items whole', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'eggs'))
    expect(cut(view)).toBe('- milk\n- eggs')
    expect(view.state.doc.toString()).toBe('intro\n\n- tea\n\nend')
  })
  test('from the first item marker takes the items whole', () => {
    const view = picked(LIST, LIST.indexOf('- milk'), after(LIST, 'eggs'))
    expect(cut(view)).toBe('- milk\n- eggs')
    expect(view.state.doc.toString()).toBe('intro\n\n- tea\n\nend')
  })
  test('up to the start of the next line keeps the next item whole', () => {
    const view = picked(LIST, LIST.indexOf('milk'), LIST.indexOf('- tea'))
    expect(cut(view)).toBe('- milk\n- eggs\n')
    expect(view.state.doc.toString()).toBe('intro\n\n- tea\n\nend')
  })
  test('up to just past the hidden marker of the next item keeps that marker', () => {
    const view = picked(LIST, LIST.indexOf('milk'), LIST.indexOf('tea'))
    expect(cut(view)).toBe('- milk\n- eggs\n')
    expect(view.state.doc.toString()).toBe('intro\n\n- tea\n\nend')
  })
  test('task items go with their boxes', () => {
    const doc = 'intro\n\n- [ ] milk\n- [x] eggs\n- [ ] tea\n\nend'
    const view = picked(doc, doc.indexOf('milk'), after(doc, 'eggs'))
    expect(cut(view)).toBe('- [ ] milk\n- [x] eggs')
    expect(view.state.doc.toString()).toBe('intro\n\n- [ ] tea\n\nend')
  })
  test('numbered items go with their numbers', () => {
    const doc = 'intro\n\n1. milk\n2. eggs\n3. tea\n\nend'
    const view = picked(doc, doc.indexOf('milk'), after(doc, 'eggs'))
    expect(cut(view)).toBe('1. milk\n2. eggs')
    expect(view.state.doc.toString()).toBe('intro\n\n3. tea\n\nend')
  })
  test('a nested item keeps its indent on the clipboard', () => {
    const doc = 'intro\n\n- milk\n  - eggs\n- tea\n\nend'
    const view = picked(doc, doc.indexOf('eggs'), after(doc, 'tea'))
    expect(cut(view)).toBe('  - eggs\n- tea')
    expect(view.state.doc.toString()).toBe('intro\n\n- milk\n\nend')
  })
  test('items at the end of the note leave no empty line', () => {
    const doc = 'intro\n- milk\n- eggs'
    const view = picked(doc, doc.indexOf('milk'), doc.length)
    expect(cut(view)).toBe('- milk\n- eggs')
    expect(view.state.doc.toString()).toBe('intro')
  })
  test('items in a quote go with the quote marks', () => {
    const doc = 'intro\n\n> - milk\n> - eggs\n> - tea\n\nend'
    const view = picked(doc, doc.indexOf('milk'), after(doc, 'eggs'))
    expect(cut(view)).toBe('> - milk\n> - eggs')
    expect(view.state.doc.toString()).toBe('intro\n\n> - tea\n\nend')
  })
  test('a selection from heading words takes the heading line whole', () => {
    const doc = 'intro\n\n# Title\nsome words\n\nend'
    const view = picked(doc, doc.indexOf('Title'), after(doc, 'some words'))
    expect(cut(view)).toBe('# Title\nsome words')
    expect(view.state.doc.toString()).toBe('intro\n\n\nend')
  })
})
describe('deleting a selection that covers whole list items', () => {
  test('Backspace takes the items whole', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'eggs'))
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('intro\n\n- tea\n\nend')
  })
  test('Delete takes the items whole', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'eggs'))
    press(view, 'Delete')
    expect(view.state.doc.toString()).toBe('intro\n\n- tea\n\nend')
  })
  test('the caret lands in the words of the item that follows', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'eggs'))
    press(view, 'Backspace')
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf('tea'))
  })
})
describe('selections that stay as they were', () => {
  test('part of one item cuts only those words', () => {
    const view = picked(LIST, LIST.indexOf('ilk'), after(LIST, 'mil'))
    expect(cut(view)).toBe('il')
    expect(view.state.doc.toString()).toBe('intro\n\n- mk\n- eggs\n- tea\n\nend')
  })
  test('all the words of one item cut only the words', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'milk'))
    expect(cut(view)).toBe('milk')
    expect(view.state.doc.toString()).toBe('intro\n\n- \n- eggs\n- tea\n\nend')
  })
  test('plain lines cut only what is selected', () => {
    const doc = 'one\ntwo\nthree'
    const view = picked(doc, 0, after(doc, 'two'))
    expect(cut(view)).toBe('one\ntwo')
    expect(view.state.doc.toString()).toBe('\nthree')
  })
  test('a selection ending inside the last item joins what is left', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'eg'))
    expect(cut(view)).toBe('milk\n- eg')
    expect(view.state.doc.toString()).toBe('intro\n\n- gs\n- tea\n\nend')
  })
  test('in source mode, where the markers show, a cut takes what is selected', () => {
    const view = picked(LIST, LIST.indexOf('milk'), after(LIST, 'eggs'), true)
    expect(cut(view)).toBe('milk\n- eggs')
    expect(view.state.doc.toString()).toBe('intro\n\n- \n- tea\n\nend')
  })
})
