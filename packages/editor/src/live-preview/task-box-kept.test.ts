// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'

const NOTE = '# Day\n\nabove\n\n- [ ] buy milk\n- [x] essen (30 min)\n- [x] plain done\n\nbelow\n'
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function shown(): EditorView {
  const view = createEditor({ parent: document.body, doc: NOTE })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select' })
  return view
}
const same = (one: Element[], other: Element[]) =>
  one.length === other.length && one.every((box, at) => box === other[at])
const boxes = (view: EditorView) => [...view.contentDOM.querySelectorAll<HTMLInputElement>('input.orden-checkbox')]
function typeAfter(view: EditorView, words: string) {
  for (const letter of 'abc') {
    const at = view.state.doc.toString().indexOf(words) + words.length
    view.dispatch({ changes: { from: at, insert: letter }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
    words += letter
  }
}
describe('typing keeps the boxes of task lines drawn', () => {
  test('typing on a line above keeps every box', () => {
    const view = shown()
    const before = boxes(view)
    expect(before).toHaveLength(3)
    typeAfter(view, 'above')
    expect(same(boxes(view), before)).toBe(true)
  })
  test('typing in the words of a done task with a time keeps its box', () => {
    const view = shown()
    const before = boxes(view)
    typeAfter(view, 'essen')
    expect(same(boxes(view), before)).toBe(true)
  })
  test('typing at the end of a done task keeps its box', () => {
    const view = shown()
    const before = boxes(view)
    typeAfter(view, 'essen (30 min)')
    expect(same(boxes(view), before)).toBe(true)
  })
  test('a box kept through typing above still ticks its own line', () => {
    const view = shown()
    typeAfter(view, 'above')
    const box = boxes(view)[0]
    box?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toContain('- [x] buy milk')
    expect(view.state.doc.toString()).toContain('- [x] essen (30 min)')
  })
  test('ticking redraws the same box ticked', () => {
    const view = shown()
    const box = boxes(view)[2]
    box?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toContain('- [ ] plain done')
    expect(boxes(view)[2]).toBe(box)
    expect(box?.checked).toBe(false)
  })
})
