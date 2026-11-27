// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'

const NOTE = 'today:\n- [ ] spca lecture (2.5h)\n- [ ] quaestur briefe\n\nend'
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
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  return view
}
const box = (view: EditorView) => view.contentDOM.querySelector<HTMLInputElement>('input.orden-checkbox')
function click(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}
function seen(view: EditorView) {
  const input = box(view)
  return {
    stored: view.state.doc.line(2).text.slice(0, 5),
    box: input?.checked,
    crossed: input?.closest('.cm-line')?.classList.contains('orden-task-done'),
  }
}
describe('ticking a task by its box', () => {
  test('one click ticks the box and crosses the words out together, a second undoes both', () => {
    const view = shown()
    expect(seen(view)).toEqual({ stored: '- [ ]', box: false, crossed: false })
    const input = box(view)
    if (!input) throw new Error('no box')
    click(input)
    expect(seen(view)).toEqual({ stored: '- [x]', box: true, crossed: true })
    click(input)
    expect(seen(view)).toEqual({ stored: '- [ ]', box: false, crossed: false })
  })
  test('the space key on the box ticks it the same way', () => {
    const view = shown()
    const input = box(view)
    if (!input) throw new Error('no box')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(seen(view)).toEqual({ stored: '- [x]', box: true, crossed: true })
  })
})
