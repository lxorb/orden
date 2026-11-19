// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createEditor } from '../editor'
import { SharedDoc } from '../shared'
import { flushTableEdits } from './view'

const TABLE = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
const TYPED = 'words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2   |\n\nend'
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
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === text)
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

describe('a cell being typed in, while the note is edited elsewhere', () => {
  test('writes each word into the note as it is typed', () => {
    const shared = new SharedDoc(TABLE)
    note(shared)
    typeInCell(note(shared))
    expect(shared.text.toString()).toBe(TYPED)
  })

  test('keeps its words when another pane writes above the table', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    shared.edit([{ from: 0, to: 0, insert: 'more ' }])
    await settled()

    expect(firstCell(view)?.textContent).toBe('1x')
    flushTableEdits()
    expect(shared.text.toString()).toBe(`more ${TYPED}`)
  })

  test('keeps its words and its caret when another cell is written', async () => {
    const view = note()
    typeInCell(view)

    replaced(view, '| 2   |', '| 2y  |')
    await settled()

    const cell = firstCell(view)
    expect(cell?.textContent).toBe('1x')
    expect(document.activeElement).toBe(cell)
    flushTableEdits()
    expect(view.state.doc.toString()).toBe(TYPED.replace('| 2   |', '| 2y  |'))
  })

  test('keeps its words when another pane writes above the table and in another cell', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    const at = TYPED.indexOf('| 2   |') + 2
    shared.edit([
      { from: 0, to: 0, insert: 'more ' },
      { from: at, to: at + 1, insert: '2y' },
    ])
    await settled()

    expect(firstCell(view)?.textContent).toBe('1x')
    flushTableEdits()
    expect(shared.text.toString()).toBe('more words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2y  |\n\nend')
  })

  test('keeps its words and its row when another pane puts a row above it', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    shared.replace(TYPED.replace('| --- | --- |\n', '| --- | --- |\n| 0 | 0 |\n'))
    await settled()

    flushTableEdits()
    expect(shared.text.toString()).toBe('words\n\n| a   | b   |\n| --- | --- |\n| 0   | 0   |\n| 1x  | 2   |\n\nend')
  })

  test('never puts its words into another table that took its place', async () => {
    const second = '| a | b |\n| --- | --- |\n| 1 | 3 |'
    const doc = `${TABLE}\n\n${second}\n`
    const shared = new SharedDoc(doc)
    const view = note(shared)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } })
    forceParsing(view, view.state.doc.length, 10_000)
    typeInCell(view)

    const now = shared.text.toString()
    shared.edit([{ from: now.indexOf('| a'), to: now.lastIndexOf('| a'), insert: '' }])
    await settled()

    flushTableEdits()
    expect(shared.text.toString()).toBe(`words\n\n${second}\n`)
  })

  test('keeps its words when another pane writes the whole table again, its widths too', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    const from = TYPED.indexOf('| a')
    const to = TYPED.indexOf('\n\nend')
    shared.edit([{ from, to, insert: '| a   | b    |\n| --- | ---- |\n| 1x  | 2yyy |' }])
    await settled()

    expect(firstCell(view)?.textContent).toBe('1x')
    flushTableEdits()
    expect(shared.text.toString()).toBe('words\n\n| a   | b    |\n| --- | ---- |\n| 1x  | 2yyy |\n\nend')
  })

  test('keeps its words when the note is rewritten from above the table into it', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    shared.replace(TYPED.replace('words', 'more words').replace('| 2   |', '| 2y  |'))
    await settled()

    flushTableEdits()
    expect(shared.text.toString()).toBe('more words\n\n| a   | b   |\n| --- | --- |\n| 1x  | 2y  |\n\nend')
  })

  test('never moves its words to a row above that only shares the cell it was typed in', async () => {
    const two = 'words\n\n| a | b |\n| --- | --- |\n| 0 | 0 |\n| 1 | 2 |\n\nend'
    const shared = new SharedDoc(two)
    const view = note(shared)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: two } })
    forceParsing(view, view.state.doc.length, 10_000)
    typeInCell(view)

    const at = shared.text.toString().indexOf('| 1x')
    shared.edit([{ from: at, to: at, insert: '| 1 | 9 |\n' }])
    await settled()

    flushTableEdits()
    expect(shared.text.toString()).toBe(
      'words\n\n| a   | b   |\n| --- | --- |\n| 0   | 0   |\n| 1   | 9   |\n| 1x  | 2   |\n\nend',
    )
  })

  test('gives way to the other words when that very cell was written', async () => {
    const view = note()
    typeInCell(view)

    replaced(view, '| 1x  |', '| 1z  |')
    await settled()

    expect(firstCell(view)?.textContent).toBe('1z')
    flushTableEdits()
    expect(view.state.doc.toString()).toBe(TYPED.replace('| 1x  |', '| 1z  |'))
  })

  test('keeps its words and its caret when the note is changed above and below the table at once', async () => {
    const shared = new SharedDoc(TABLE)
    const view = note(shared)
    typeInCell(view)

    shared.replace(TYPED.replace('words', 'w').replace('end', 'end!'))
    await settled()
    flushTableEdits()

    expect(shared.text.toString()).toBe(TYPED.replace('words', 'w').replace('end', 'end!'))
    expect(document.activeElement).toBe(firstCell(view))
  })

  test('follows its words when the rows are put in another order', async () => {
    const two = 'words\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 0 | 0 |\n\nend'
    const shared = new SharedDoc(two)
    const view = note(shared)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: two } })
    forceParsing(view, view.state.doc.length, 10_000)
    typeInCell(view)

    const [head = '', rule = '', first = '', second = ''] = shared.text.toString().split('\n').slice(2)
    shared.replace(`words\n\n${[head, rule, second, first].join('\n')}\n\nend`)
    await settled()

    expect(document.activeElement?.textContent).toBe('1x')
    expect((document.activeElement as HTMLElement | null)?.dataset.row).toBe('1')
  })
})
