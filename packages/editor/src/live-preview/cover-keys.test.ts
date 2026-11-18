// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'

const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const NOTE = '---\ntitle: Trip\ncover: wide.jpg\n---\n\n# Trip\n\nWords.\n'

function viewOf(doc: string) {
  const view = createEditor({ parent: document.body, doc, selection: { anchor: doc.length } })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({})
  return view
}

function press(key: string) {
  const handle = document.activeElement
  handle?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe("the cover's slider moved with the keyboard", () => {
  test('keeps the focus, so a second ArrowUp moves the cover again', () => {
    const view = viewOf(NOTE)
    const handle = view.dom.querySelector<HTMLElement>('.orden-cover-drag')
    expect(handle).not.toBeNull()
    handle?.focus()
    expect(document.activeElement).toBe(handle)

    press('ArrowUp')
    expect(view.state.doc.toString()).toContain('cover-position: 55')
    expect(document.activeElement?.classList.contains('orden-cover-drag')).toBe(true)

    press('ArrowUp')
    expect(view.state.doc.toString()).toContain('cover-position: 60')
  })
})
