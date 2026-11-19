// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { renderMarkdown } from '@orden/markdown'
import { beforeAll, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { livePreview } from '.'

const DROPPED = 'Trip\n\n![](day-1.png)\n![](day-2.png)\n![](day-3.png)\n\nend'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 800, 20)
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.setPointerCapture = () => undefined
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => 800,
  })
})

function opened(doc: string): EditorView {
  return new EditorView({
    state: parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), livePreview()],
      }),
    ),
    parent: document.body,
  })
}

function halved(view: EditorView) {
  const handle = view.contentDOM.querySelector<HTMLElement>('.orden-image-handle[data-corner="se"]')
  handle?.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, clientX: 800 }))
  handle?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 }))
  handle?.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true, clientX: 400 }))
}

test('resizing the first of several dropped pictures keeps the pictures under it in the reading view', () => {
  const view = opened(DROPPED)
  halved(view)
  const written = view.state.doc.toString()
  view.destroy()
  expect(written).toContain('zoom:50%')
  const drawn = renderMarkdown(written)
  expect(drawn).toContain('<img src="day-2.png"')
  expect(drawn).toContain('<img src="day-3.png"')
})

test('resizing a picture keeps the caption under it drawn as words in the reading view', () => {
  const note = 'Intro\n\n![](chart.png)\n*Figure 1: [[Sales]] by month*\n\nend'
  expect(renderMarkdown(note)).toContain('<em>Figure 1: Sales by month</em>')
  const view = opened(note)
  halved(view)
  const written = view.state.doc.toString()
  view.destroy()
  expect(written).toContain('zoom:50%')
  expect(renderMarkdown(written)).toContain('<em>Figure 1: Sales by month</em>')
})
