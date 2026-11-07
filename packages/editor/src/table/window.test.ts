// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { tableViewAt } from './widget'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function tableOf(rows: number): string {
  const body = Array.from({ length: rows }, (_, row) => `| r${row} | s${row} |\n`).join('')
  return `| a | b |\n| --- | --- |\n${body}`
}

function editorOn(doc: string): EditorView {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  forceParsing(view, doc.length, 10_000)
  return view
}

const drawn = (view: EditorView) =>
  [...view.dom.querySelectorAll<HTMLElement>('.nib-table tbody tr[data-row]')].map((tr) =>
    Number(tr.dataset.row),
  )

describe('a long table', () => {
  const TABLE = tableOf(5000)
  const DOC = `# T\n\n${TABLE}\nend`

  test('draws the rows near the screen rather than every row', () => {
    const view = editorOn(DOC)
    const rows = drawn(view)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(200)
    expect(view.dom.querySelectorAll('.nib-table tbody tr.nib-table-gap').length).toBe(1)
  })

  test('draws a row far down the moment a cell of it is asked for', () => {
    const view = editorOn(DOC)
    const table = tableViewAt(view, DOC.indexOf('|'))
    if (!table) throw new Error('no table drawn')

    expect(table.focusCell({ row: 4000, column: 1 }, 'end')).toBe(true)
    expect(view.dom.querySelector('td[data-row="4000"][data-column="1"]')?.textContent).toBe(
      's4000',
    )
    expect(drawn(view).length).toBeLessThan(200)
  })

  test('a short table still draws every row', () => {
    const short = `# T\n\n${tableOf(40)}\nend`
    expect(drawn(editorOn(short))).toEqual(Array.from({ length: 40 }, (_, row) => row))
  })
})
