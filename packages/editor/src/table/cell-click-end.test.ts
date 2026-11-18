// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from '../editor'
import { parsed } from '../../test/parsed'

const LETTER = 10

let shown: HTMLElement | null = null

function letterAt(x: number): { node: Node; offset: number } | null {
  if (!shown) return null
  const wanted = Math.round(x / LETTER)
  const walker = document.createTreeWalker(shown, NodeFilter.SHOW_TEXT)
  let passed = 0
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (wanted <= passed + node.length) return { node, offset: wanted - passed }
    passed += node.length
    last = node
  }
  return last ? { node: last, offset: last.length } : null
}

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Object.assign(document, {
    caretRangeFromPoint: (x: number) => {
      const found = letterAt(x)
      if (!found) return null
      const range = document.createRange()
      range.setStart(found.node, found.offset)
      return range
    },
  })
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
  shown = null
})

function cellOf(words: string): HTMLElement {
  const note = `intro\n\n| name | note |\n| - | - |\n| ${words} | plain |\n\nend\n`
  const view = new EditorView({
    state: parsed(editorState({ doc: note, selection: { anchor: note.length } })),
    parent: document.body,
  })
  open.push(view)
  const cell = view.contentDOM.querySelector<HTMLElement>('td')
  if (!cell) throw new Error('no drawn cell')
  cell.tabIndex = 0
  return cell
}

function clickAfterLetters(cell: HTMLElement, letters: number): number {
  shown = cell
  const x = letters * LETTER
  const keys = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 1 }
  cell.dispatchEvent(new MouseEvent('mousedown', keys))
  cell.dispatchEvent(new MouseEvent('mouseup', keys))
  cell.dispatchEvent(new MouseEvent('click', keys))

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) throw new Error('no caret')
  const caret = selection.getRangeAt(0)
  const before = document.createRange()
  before.selectNodeContents(cell)
  before.setEnd(caret.endContainer, caret.endOffset)
  return before.toString().length
}

describe('a click past the words of a drawn table cell', () => {
  test('puts the caret after a wikilink that ends the cell, not inside its brackets', () => {
    const cell = cellOf('see [[Project plan]]')
    expect(cell.textContent).toBe('see Project plan')

    const caret = clickAfterLetters(cell, 'see Project plan'.length + 4)

    expect(cell.textContent).toBe('see [[Project plan]]')
    expect(caret).toBe('see [[Project plan]]'.length)
  })

  test('puts the caret after inline code that ends the cell, not inside the code', () => {
    const cell = cellOf('run `npm install`')
    expect(cell.textContent).toBe('run npm install')

    const caret = clickAfterLetters(cell, 'run npm install'.length + 4)

    expect(caret).toBe('run `npm install`'.length)
  })

  test('puts the caret after a link that ends the cell, not inside its words', () => {
    const cell = cellOf('read [the docs](https://x.test)')

    const caret = clickAfterLetters(cell, 'read the docs'.length + 4)

    expect(caret).toBe('read [the docs](https://x.test)'.length)
  })
})
