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

test('a note dropped just before the pane moves to another note is linked in its own note', async () => {
  const first = new SharedDoc('mine ')
  const second = new SharedDoc('theirs ')
  const view = createEditor({
    parent: document.body,
    shared: first,
    selection: { anchor: 0 },
    carriedNotes: () => ['Plan.md'],
  })
  open.push(view)
  Object.assign(view, { posAtCoords: () => 5 })
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))

  view.contentDOM.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  firstHeld.take(view)
  secondHeld.give(view)
  await import('./note-links')
  for (let round = 0; round < 5; round++) await Promise.resolve()

  expect(second.text.toString()).toBe('theirs ')
  expect(first.text.toString()).toContain('Plan')
})
