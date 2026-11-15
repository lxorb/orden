// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { SharedDoc } from '../shared'
import { flushTableEdits } from './view'

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  HTMLTableCellElement.prototype.focus = function (this: HTMLTableCellElement, options) {
    this.tabIndex = 0
    HTMLElement.prototype.focus.call(this, options)
  }
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function note(shared?: SharedDoc): EditorView {
  const view = createEditor({
    parent: document.body,
    doc: TABLE,
    ...(shared ? { shared } : {}),
    selection: { anchor: TABLE.length },
  })
  open.push(view)
  forceParsing(view, TABLE.length, 10_000)
  return view
}

function cellHolding(view: EditorView, text: string): HTMLElement {
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
    (one) => one.textContent === text,
  )
  if (!cell) throw new Error(`the table drew no cell holding ${text}`)
  return cell
}

function typeInCell(view: EditorView) {
  const cell = cellHolding(view, '1')
  cell.focus()
  cell.textContent = '1x'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

function firstCell(view: EditorView): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>('td[data-row="0"][data-column="0"]')
}

async function settled() {
  for (let round = 0; round < 3; round++) await Promise.resolve()
}

function replaced(view: EditorView, from: string, to: string) {
  const at = view.state.doc.toString().indexOf(from)
  view.dispatch({ changes: { from: at, to: at + from.length, insert: to } })
}

describe('a cell typed in and not yet written, while the note is edited elsewhere', () => {
  test('keeps its words when another pane writes above the table', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    shared.edit([{ from: 0, to: 0, insert: 'more ' }])
    await settled()

    expect(firstCell(view)?.textContent).toBe('1x')
    flushTableEdits()
    expect(shared.text.toString()).toBe(
      'more words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2   |\n\nend',
    )
  })

  test('keeps its words and its caret when another cell is written', async () => {
    const view = note()
    typeInCell(view)

    replaced(view, '| 2 |', '| 2y |')
    await settled()

    const cell = firstCell(view)
    expect(cell?.textContent).toBe('1x')
    expect(document.activeElement).toBe(cell)
    flushTableEdits()
    expect(view.state.doc.toString()).toBe(
      'words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2y  |\n\nend',
    )
  })

  test('keeps its words when another pane writes above the table and in another cell', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    const at = TABLE.indexOf('| 2 |') + 2
    shared.edit([
      { from: 0, to: 0, insert: 'more ' },
      { from: at, to: at + 1, insert: '2y' },
    ])
    await settled()

    expect(firstCell(view)?.textContent).toBe('1x')
    flushTableEdits()
    expect(shared.text.toString()).toBe(
      'more words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2y  |\n\nend',
    )
  })

  test('keeps its words and its row when another pane puts a row above it', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    shared.replace(TABLE.replace('| --- | --- |\n', '| --- | --- |\n| 0 | 0 |\n'))
    await settled()

    flushTableEdits()
    expect(shared.text.toString()).toBe(
      'words\n\n| a   | b   |\n| --- | --- |\n| 0   | 0   |\n| 1x  | 2   |\n\nend',
    )
  })

  test('never puts its words into another table that took its place', async () => {
    const second = '| a | b |\n| --- | --- |\n| 1 | 3 |'
    const doc = `${TABLE}\n\n${second}\n`
    const shared = new SharedDoc(doc)
    const view = note(shared)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } })
    forceParsing(view, view.state.doc.length, 10_000)
    typeInCell(view)

    const start = doc.indexOf('| a')
    shared.edit([{ from: start, to: doc.lastIndexOf('| a'), insert: '' }])
    await settled()

    flushTableEdits()
    expect(shared.text.toString()).toBe(`words\n\n${second}\n`)
  })

  test('gives way to the other words when that very cell was written', async () => {
    const view = note()
    typeInCell(view)

    replaced(view, '| 1 |', '| 1z |')
    await settled()

    expect(firstCell(view)?.textContent).toBe('1z')
    flushTableEdits()
    expect(view.state.doc.toString()).toBe(TABLE.replace('| 1 |', '| 1z |'))
  })
})
