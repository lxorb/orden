// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../../test/parsed'
import { ordenMarkdownExtensions } from '../../markdown/extensions'
import { livePreview } from '..'

const DOC = 'words\n\n![A cat](cat.png)\n\nend'
const errors: unknown[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
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

function typedAlt(text: string, doc = DOC): EditorView {
  const view = new EditorView({
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
        ],
      }),
    ),
    parent: document.body,
  })
  const alt = view.contentDOM.querySelector('input')
  alt?.focus()
  if (alt) alt.value = text
  return view
}

test('is written to the picture when the field is left', async () => {
  const view = typedAlt('A dog')
  view.focus()
  await Promise.resolve()
  expect(view.state.doc.toString()).toBe(DOC.replace('A cat', 'A dog'))
  view.destroy()
})

test('is let go of, and throws nothing, when its picture was taken away', async () => {
  const view = typedAlt('A dog')
  view.dispatch({ changes: { from: DOC.indexOf('!'), to: DOC.indexOf('\n\nend'), insert: '' } })
  await Promise.resolve()
  expect(errors).toEqual([])
  expect(view.state.doc.toString()).toBe('words\n\n\n\nend')
  view.destroy()
})

test('in a picture wrapped in HTML, is written to its img tag and leaves the wrapper', async () => {
  const doc = 'words\n\n<p align="center"><img src="cat.png" alt="A cat"></p>\n\nend'
  const view = typedAlt('A dog', doc)
  view.focus()
  await Promise.resolve()
  expect(view.state.doc.toString()).toBe(
    'words\n\n<p align="center"><img src="cat.png" alt="A dog" /></p>\n\nend',
  )
  view.destroy()
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
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
        ],
      }),
    ),
    parent: document.body,
  })
  const handle = view.contentDOM.querySelector<HTMLElement>('.orden-image-handle')
  expect(handle).not.toBeNull()
  handle?.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  handle?.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
  expect(view.state.doc.toString()).toBe(doc)
  view.destroy()
})
