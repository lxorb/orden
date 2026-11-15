// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { createEditor } from '../editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const view of open.splice(0)) view.destroy()
})

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend'

function compose(cell: HTMLElement, text: string) {
  cell.textContent = text
  cell.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }))
}

describe('an input method in a table cell', () => {
  test('writes only the committed text, and its Enter stays in the cell', () => {
    vi.useFakeTimers()
    const view = createEditor({
      parent: document.body,
      doc: TABLE,
      selection: { anchor: TABLE.length },
    })
    open.push(view)
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
      (one) => one.textContent === '1',
    )
    if (!cell) throw new Error('the table drew no cell holding 1')
    cell.focus()

    cell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    compose(cell, "1zhong'wen")
    vi.advanceTimersByTime(1200)
    expect(view.state.doc.toString()).toBe(TABLE)

    cell.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    )
    compose(cell, '1中文')
    cell.dispatchEvent(new CompositionEvent('compositionend', { data: '中文', bubbles: true }))
    vi.advanceTimersByTime(1200)

    expect(view.state.doc.toString()).toBe(
      '| a     | b   |\n| ----- | --- |\n| 1中文 | 2   |\n\nend',
    )
  })

  test('keeps the words being composed when another cell is written meanwhile', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nend'
    const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
    open.push(view)
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
      (one) => one.textContent === '1',
    )
    if (!cell) throw new Error('the table drew no cell holding 1')
    cell.tabIndex = 0
    cell.focus()
    cell.textContent = '1x'
    cell.dispatchEvent(new InputEvent('input', { bubbles: true }))

    cell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    compose(cell, '1xか')
    const three = view.state.doc.toString().indexOf('| 3') + 3
    view.dispatch({ changes: { from: three, insert: 'Z' } })
    cell.dispatchEvent(new CompositionEvent('compositionend', { data: 'か', bubbles: true }))

    expect(cell.isConnected).toBe(true)
    expect(cell.textContent).toBe('1xか')
    expect(view.state.doc.toString()).toContain('| 1xか |')
    expect(view.state.doc.toString()).toContain('3Z')
  })

  test('does not write the words being composed into a row another writer moved there', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nend'
    const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
    open.push(view)
    const cell = [...view.dom.querySelectorAll<HTMLElement>('td')].find(
      (one) => one.textContent === '1',
    )
    if (!cell) throw new Error('the table drew no cell holding 1')
    cell.tabIndex = 0
    cell.focus()

    cell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    compose(cell, '1か')
    const rows = view.state.doc.toString().indexOf('| 1')
    const end = view.state.doc.toString().indexOf('\n\nend')
    view.dispatch({ changes: { from: rows, to: end, insert: '| 3 | 4 |\n| 1 | 2 |' } })
    cell.dispatchEvent(new CompositionEvent('compositionend', { data: 'か', bubbles: true }))

    const written = view.state.doc.toString().split('\n').slice(2, 4)
    expect(written.map((row) => row.split('|')[2]?.trim())).toEqual(['4', '2'])
    expect(written.map((row) => row.split('|')[1]?.trim())).not.toContain('3か')
    expect(view.state.doc.toString()).toContain('3')
  })
})
