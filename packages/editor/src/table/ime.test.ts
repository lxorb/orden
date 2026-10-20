// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { createEditor } from '../editor'

/** Chinese typed into a cell through an input method: the pinyin is the input
 *  method's until it commits, and so is the Enter that picks the characters.
 *
 *  jsdom lays nothing out, so a range has no rectangles to measure. */

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
})
