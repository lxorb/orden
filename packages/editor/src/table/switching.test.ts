// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { createEditor, editorState } from '../editor'
import { HeldState } from '../held'
import { SharedDoc } from '../shared'

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
const TYPED = 'words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2   |\n\nend'
const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function typeInCell(view: EditorView) {
  forceParsing(view, view.state.doc.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
  if (!cell) throw new Error('the table drew no cell holding 1')
  cell.tabIndex = 0
  cell.focus()
  cell.textContent = '1x'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
}
async function settled() {
  for (let round = 0; round < 3; round++) await Promise.resolve()
}
test('words typed in a cell and left by a switch to another note go to their own note', async () => {
  const first = new SharedDoc(TABLE)
  const second = new SharedDoc(TABLE)
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  typeInCell(view)
  firstHeld.take(view)
  secondHeld.give(view)
  await settled()
  expect(first.text.toString()).toBe(TYPED)
  expect(firstHeld.state.doc.toString()).toBe(TYPED)
  expect(second.text.toString()).toBe(TABLE)
  expect(view.state.doc.toString()).toBe(TABLE)
})
test('words typed in a cell and left by a switch to a different note are not lost', async () => {
  const first = new SharedDoc(TABLE)
  const elsewhere = 'other words'
  const second = new SharedDoc(elsewhere)
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  typeInCell(view)
  firstHeld.take(view)
  secondHeld.give(view)
  await settled()
  expect(first.text.toString()).toBe(TYPED)
  expect(second.text.toString()).toBe(elsewhere)
  expect(view.state.doc.toString()).toBe(elsewhere)
})
test('words typed in a cell after words were written above the table go to their own note', async () => {
  const first = new SharedDoc(TABLE)
  const second = new SharedDoc(TABLE)
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  view.dispatch({ changes: { from: 0, insert: 'more ' }, selection: { anchor: 5 } })
  typeInCell(view)
  firstHeld.take(view)
  secondHeld.give(view)
  await settled()
  expect(first.text.toString()).toBe(`more ${TYPED}`)
  expect(second.text.toString()).toBe(TABLE)
})
test('words typed in a cell, then words written below the table, both stay when the note is left', async () => {
  const first = new SharedDoc(TABLE)
  const second = new SharedDoc('other words')
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  typeInCell(view)
  view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
  firstHeld.take(view)
  secondHeld.give(view)
  await settled()
  expect(first.text.toString()).toBe(`${TYPED}!`)
})
test('a switch to a note with a table in the same place leaves the focus out of that table', async () => {
  const first = new SharedDoc(TABLE)
  const second = new SharedDoc('other\n\n| x | y |\n| --- | --- |\n| 7 | 8 |\n\nend')
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  const focus = vi.spyOn(HTMLTableCellElement.prototype, 'focus').mockImplementation(function (
    this: HTMLTableCellElement,
  ) {
    this.tabIndex = 0
    HTMLElement.prototype.focus.call(this)
  })
  typeInCell(view)
  firstHeld.take(view)
  secondHeld.give(view)
  await settled()
  focus.mockRestore()
  expect(document.activeElement?.closest('table')).toBeNull()
})
