// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { moveBlocks } from './commands'
import { editorState } from '../editor'
import { parsed } from '../../test/parsed'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
describe('a footnote definition right under a paragraph', () => {
  test('is passed as a block of its own when the paragraph moves down', () => {
    const doc = 'Claim.[^1]\n[^1]: Smith, 2020.\n\nNext para'
    const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
    open.push(view)
    expect(moveBlocks(view, 2, 1)).toBe(true)
    expect(view.state.doc.toString()).toBe('[^1]: Smith, 2020.\n\nClaim.[^1]\n\nNext para')
  })
})
