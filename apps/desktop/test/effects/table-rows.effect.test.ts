import { afterEach, expect, test } from 'vitest'
import { createEditor, type EditorView } from '@orden/editor'

const NOTE = '| What  | Where |\n| ----- | ----- |\n| Notes | here  |\n| Ideas | there |\n'

let editor: EditorView | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function mounted() {
  const parent = document.createElement('div')
  document.body.append(parent)
  editor = createEditor({ parent, doc: NOTE })
  const table = parent.querySelector<HTMLElement>('.nib-table-wrap')
  if (!table) throw new Error('no table was drawn')

  return table
}

const firstCell = (table: HTMLElement, row: number) =>
  table.querySelector<HTMLElement>(`td[data-row="${row}"][data-column="0"]`)

function enter(cell: HTMLElement | null) {
  cell?.dispatchEvent(new FocusEvent('focus'))
  cell?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

function leave(cell: HTMLElement | null) {
  cell?.dispatchEvent(new FocusEvent('blur'))
  cell?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
}

function pass(over: Element | null | undefined, pointerType: string) {
  over?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType }))
  over?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
}

test('a row has its controls while its first cell is written in', () => {
  const table = mounted()
  enter(firstCell(table, 0))

  const rows = table.querySelector('.nib-table-rows')
  expect(rows?.classList.contains('is-shown')).toBe(true)
  expect(rows?.querySelectorAll('button')).toHaveLength(4)
})

test('and keeps them once the caret has gone again', () => {
  const table = mounted()
  enter(firstCell(table, 0))
  leave(firstCell(table, 0))

  pass(firstCell(table, 0), 'mouse')

  expect(table.querySelector('.nib-table-rows')?.classList.contains('is-shown')).toBe(true)
})

test('what they do lands on the row they were brought up for', () => {
  const table = mounted()
  pass(firstCell(table, 1), 'mouse')

  const up = table.querySelector<HTMLButtonElement>('.nib-table-rows button')
  up?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

  expect(editor?.state.doc.toString()).toBe(
    '| What  | Where |\n| ----- | ----- |\n| Ideas | there |\n| Notes | here  |\n',
  )
})

test('a finger passing over a cell brings neither bar up', () => {
  const table = mounted()
  pass(firstCell(table, 0), 'touch')
  pass(table.querySelector('th'), 'touch')

  expect(table.querySelector('.nib-table-rows')?.classList.contains('is-shown')).toBe(false)
  expect(table.querySelector('.nib-table-columns')?.classList.contains('is-shown')).toBe(false)
})
