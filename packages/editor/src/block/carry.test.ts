// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createEditor, editorState } from '../editor'
import { HeldState } from '../held'
import { SharedDoc } from '../shared'

const open: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
test('a block carried while the pane moves to another note is let go, and neither note changes', () => {
  const mine = 'one\n\ntwo\n\nthree\n'
  const theirs = 'alpha\n\nbeta\n\ngamma\n\ndelta\n'
  const first = new SharedDoc(mine)
  const second = new SharedDoc(theirs)
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  Object.assign(view, {
    posAtCoords: ({ y }: { y: number }) => (y > 50 ? view.state.doc.length : 0),
    lineBlockAt: () => ({ top: 0, bottom: 10 }),
  })
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  const handle = view.dom.querySelector<HTMLElement>('.orden-block-handle')
  if (!handle) throw new Error('no block handle drawn')
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 0 }))
  firstHeld.take(view)
  secondHeld.give(view)
  const doc = view.dom.ownerDocument
  doc.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 100 }))
  doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 100 }))
  expect(view.state.doc.toString()).toBe(theirs)
  expect(second.text.toString()).toBe(theirs)
  expect(first.text.toString()).toBe(mine)
})
