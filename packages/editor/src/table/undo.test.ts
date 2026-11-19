// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { StateEffectType, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { carryIntoEditors, createEditor } from '../editor'
import { SharedDoc, undoEdit } from '../shared'
import { insertTableToEdit } from './keymap'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  HTMLTableCellElement.prototype.focus = function (this: HTMLTableCellElement, options) {
    this.tabIndex = 0
    HTMLElement.prototype.focus.call(this, options)
  }
})

const open: EditorView[] = []
const seen: Transaction[] = []
carryIntoEditors(EditorView.updateListener.of((update) => seen.push(...update.transactions)))

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const TABLE = '| a |\n| --- |\n| 1 |\n\nend'

function note(on: { shared?: SharedDoc } = {}): EditorView {
  const view = createEditor({
    parent: document.body,
    doc: TABLE,
    ...on,
    selection: { anchor: TABLE.length },
  })
  open.push(view)
  return view
}

function typeInCell(view: EditorView): HTMLElement {
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
  if (!cell) throw new Error('the table drew no cell holding 1')
  cell.focus()
  cell.textContent = '1XYZ'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
  return cell
}

function press(cell: HTMLElement, shiftKey = false) {
  cell.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe('undo in a table cell', () => {
  test('keeps a table under the caret of the note drawn, and the cell focused', async () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'
    const view = createEditor({ parent: document.body, doc, selection: { anchor: 0 } })
    open.push(view)
    forceParsing(view, doc.length, 10_000)
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
    if (!cell) throw new Error('the table drew no cell holding 1')
    cell.focus()
    for (const text of ['1x', '1xy']) {
      cell.textContent = text
      cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }

    press(cell)
    for (let round = 0; round < 3; round++) await Promise.resolve()

    expect(view.state.doc.toString()).toBe(doc)
    expect(view.dom.querySelector('table')).not.toBeNull()
    expect(document.activeElement?.tagName).toBe('TD')
  })

  test('takes back what was typed there, in a note shared between views', () => {
    const shared = new SharedDoc(TABLE)
    const view = note({ shared })
    const cell = typeInCell(view)

    press(cell)
    expect(view.state.doc.toString()).toBe(TABLE)
    expect(shared.text.toString()).toBe(TABLE)

    press(cell, true)
    expect(view.state.doc.toString()).toContain('1XYZ')
  })

  test('and in a note that is not', () => {
    const view = note()
    const cell = typeInCell(view)

    press(cell)
    expect(view.state.doc.toString()).toBe(TABLE)

    press(cell, true)
    expect(view.state.doc.toString()).toContain('1XYZ')
  })

  test('arriving as input, the way a Mac sends Cmd+Z', () => {
    const view = note({ shared: new SharedDoc(TABLE) })
    const cell = typeInCell(view)

    cell.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toBe(TABLE)
  })
})

describe('undo after typing in a table far down a note', () => {
  const LONG = `${Array.from({ length: 6 }, (_, n) => `line ${n}`).join('\n\n')}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n\nend`

  function typed(shared?: SharedDoc): { view: EditorView; cell: HTMLElement } {
    const view = createEditor({
      parent: document.body,
      ...(shared ? { shared } : { doc: LONG }),
      selection: { anchor: 0 },
    })
    open.push(view)
    forceParsing(view, LONG.length, 10_000)
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
    if (!cell) throw new Error('the table drew no cell holding 1')
    cell.focus()
    cell.textContent = '1x'
    cell.dispatchEvent(new InputEvent('input', { bubbles: true }))
    return { view, cell }
  }

  test.each([
    ['a note', undefined],
    ['a shared note', () => new SharedDoc(LONG)],
  ])('in %s, an undo in the cell keeps the view where it is', (_, make) => {
    const { view, cell } = typed(make?.())
    const scroll = (EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<unknown> }).type
    const from = seen.length

    press(cell)

    expect(view.state.doc.toString()).toBe(LONG)
    const scrolled = seen
      .slice(from)
      .filter((one) => one.scrollIntoView || one.effects.some((effect) => effect.is(scroll)))
    expect(scrolled.at(-1)?.scrollIntoView).toBe(false)
  })

  test.each([
    ['a note', undefined],
    ['a shared note', () => new SharedDoc(LONG)],
  ])('in %s, an undo in the note puts the caret beside the table', (_, make) => {
    const { view } = typed(make?.())
    view.contentDOM.focus()

    undoEdit(view)

    expect(view.state.doc.toString()).toBe(LONG)
    expect(view.state.selection.main.head).toBe(LONG.indexOf('| 1 | 2 |') + 10)
  })
})

test('an undo in a cell of an edit above the table keeps the view on the table', () => {
  const doc = `${Array.from({ length: 10 }, (_, n) => `line ${n}`).join('\n')}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n\nend`
  const view = createEditor({ parent: document.body, doc, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, doc.length, 10_000)
  const pasted = Array.from({ length: 40 }, (_, n) => `pasted ${n}`).join('\n') + '\n'
  view.dispatch({ changes: { from: 0, insert: pasted }, userEvent: 'input.paste' })
  forceParsing(view, view.state.doc.length, 10_000)
  const start = view.state.doc.toString().indexOf('| a')
  const anchored = view as unknown as {
    viewState: { scrollAnchorAt: (top: number) => { from: number; top: number } }
  }
  const anchorAt = anchored.viewState.scrollAnchorAt.bind(anchored.viewState)
  anchored.viewState.scrollAnchorAt = (top) => {
    anchored.viewState.scrollAnchorAt = anchorAt
    return { ...anchorAt(top), from: start, top: 0 }
  }
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
  if (!cell) throw new Error('the table drew no cell holding 1')
  cell.focus()
  const scroll = (EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<unknown> }).type
  const from = seen.length

  press(cell)

  expect(view.state.doc.toString()).toBe(doc)
  const aims = seen
    .slice(from)
    .flatMap((one) => one.effects.filter((effect) => effect.is(scroll)))
    .map((effect) => (effect.value as { range: { head: number } }).range.head)
  expect(aims.at(-1)).toBe(doc.indexOf('| a'))
})

test('typing in a cell leaves the caret off a heading right under the table', () => {
  const doc = 'top\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n# Head\n\nend'
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  forceParsing(view, doc.length, 10_000)
  const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find((one) => one.textContent === '1')
  if (!cell) throw new Error('the table drew no cell holding 1')
  cell.focus()
  cell.textContent = '1x'
  cell.dispatchEvent(new InputEvent('input', { bubbles: true }))

  const { head } = view.state.selection.main
  expect(view.state.doc.lineAt(head).text).toBe('')
})

test('an undo that takes away a table just made gives the focus back to the note', async () => {
  const view = createEditor({
    parent: document.body,
    doc: 'words\n\nend',
    selection: { anchor: 5 },
  })
  open.push(view)
  insertTableToEdit(view)
  const cell = document.activeElement
  if (!(cell instanceof HTMLElement) || cell.tagName !== 'TH') throw new Error('no header cell')

  press(cell)
  for (let round = 0; round < 3; round++) await Promise.resolve()

  expect(view.state.doc.toString()).toBe('words\n\nend')
  expect(document.activeElement).toBe(view.contentDOM)
})
