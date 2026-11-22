// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../../test/parsed'
import { ordenMarkdownExtensions } from '../../markdown/extensions'
import { livePreview } from '..'
import { noRects } from '../../../test/views'

const errors: unknown[] = []
beforeAll(() => {
  noRects()
  window.addEventListener('error', (event) => errors.push(event.error))
  Node.prototype.removeChild = <T extends Node>(child: T): T => {
    const focused = document.activeElement
    if (focused && child.contains(focused)) focused.dispatchEvent(new FocusEvent('blur'))
    ;(child as Node as ChildNode).remove()
    return child
  }
})
afterEach(() => {
  errors.length = 0
})
test('a corner pressed and let go without a drag leaves a sized picture as it was', () => {
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => 800,
  })
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => undefined
  const doc = 'words\n\n![A cat|300](cat.png)\n\nend'
  const view = new EditorView({
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), livePreview()],
      }),
    ),
    parent: document.body,
  })
  const handle = view.contentDOM.querySelector<HTMLElement>('.orden-image-handle')
  expect(handle).not.toBeNull()
  handle?.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  handle?.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
  expect(view.state.doc.toString()).toBe(doc)
  handle?.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, clientX: 50 }))
  handle?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 9 }))
  handle?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 51, clientY: 9 }))
  handle?.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true, clientX: 50 }))
  expect(view.state.doc.toString()).toBe(doc)
  view.destroy()
})
