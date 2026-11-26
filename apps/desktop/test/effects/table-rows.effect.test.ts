import { afterEach, expect, test, vi } from 'vitest'
import { createEditor, type EditorView } from '@orden/editor'

const NOTE = '| What  | Where |\n| ----- | ----- |\n| Notes | here  |\n| Ideas | there |\n'
let editor: EditorView | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})
async function mounted() {
  const parent = document.createElement('div')
  document.body.append(parent)
  editor = createEditor({ parent, doc: NOTE })
  await vi.dynamicImportSettled()
  const table = parent.querySelector<HTMLElement>('.orden-table-wrap')
  if (!table) throw new Error('no table was drawn')
  return table
}
const firstCell = (table: HTMLElement, row: number) =>
  table.querySelector<HTMLElement>(`td[data-row="${row}"][data-column="0"]`)
const shown = (table: HTMLElement, grip: 'row' | 'column') =>
  table.querySelector(`.orden-table-grip-${grip}`)?.classList.contains('is-shown')
function pass(over: Element | null | undefined, pointerType: string) {
  over?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType }))
}
test('a row and a column have their grips while the pointer is over one of their cells', async () => {
  const table = await mounted()
  expect(shown(table, 'row')).toBe(false)
  pass(firstCell(table, 1), 'mouse')
  expect(shown(table, 'row')).toBe(true)
  expect(shown(table, 'column')).toBe(true)
})
test('the header row has no grip, it cannot move', async () => {
  const table = await mounted()
  pass(table.querySelector('th'), 'mouse')
  expect(shown(table, 'row')).toBe(false)
  expect(shown(table, 'column')).toBe(true)
})
test('the bar under the table adds a row at its end', async () => {
  const table = await mounted()
  table
    .querySelector('.orden-table-add-row')
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  expect(editor?.state.doc.toString()).toBe(
    '| What  | Where |\n| ----- | ----- |\n| Notes | here  |\n| Ideas | there |\n|       |       |\n',
  )
})
test('a finger passing over a cell brings no grip up', async () => {
  const table = await mounted()
  pass(firstCell(table, 0), 'touch')
  pass(table.querySelector('th'), 'touch')
  expect(shown(table, 'row')).toBe(false)
  expect(shown(table, 'column')).toBe(false)
})
