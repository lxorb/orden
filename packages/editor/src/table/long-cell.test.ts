// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import { expect, test } from 'vitest'
import { createEditor } from '../editor'
import { keptViews } from '../../test/views'

const LONG = 'a sentence that keeps going well past what any other cell in its column holds'
const TABLE = `| a   | ${'b'.padEnd(40)} |\n| --- | ${'-'.repeat(40)} |\n| 1   | ${LONG} |\n| 3   | ${'4'.padEnd(40)} |`
const open = keptViews()
test('typing on in a long cell rewrites that row alone', () => {
  const view = createEditor({ parent: document.body, doc: `${TABLE}\n\nend`, selection: { anchor: TABLE.length + 2 } })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === LONG)
  if (!cell) throw new Error('the table drew no long cell')
  cell.tabIndex = 0
  cell.focus()
  const touched: number[] = []
  const before = view.state.doc.toString().split('\n')
  cell.textContent = `${LONG} and on`
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
  const after = view.state.doc.toString().split('\n')
  after.forEach((line, at) => {
    if (line !== before[at]) touched.push(at)
  })
  expect(touched).toEqual([2])
  expect(after[2]).toBe(`| 1   | ${LONG} and on |`)
})
