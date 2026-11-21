// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../../test/parsed'
import { noRects } from '../../../test/views'
import { ordenMarkdownExtensions } from '../../markdown/extensions'
import { livePreview } from '..'

const DOC = 'words\n\n![](https%3A//orden.so/i/d054771ca8915121)\n\nend'
const open: EditorView[] = []
beforeAll(() => noRects())
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function frameOf(doc = DOC): HTMLElement {
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
  open.push(view)
  const frame = view.contentDOM.querySelector<HTMLElement>('.orden-image-frame')
  if (!frame) throw new Error('no picture drawn')
  return frame
}
describe('a picture that could not be loaded', () => {
  test('is drawn as missing straight away when drawn again, so its height never jumps', () => {
    const first = frameOf()
    expect(first.classList.contains('is-loading')).toBe(true)
    first.querySelector('img')?.dispatchEvent(new Event('error'))
    expect(first.classList.contains('is-broken')).toBe(true)
    const again = frameOf()
    expect(again.classList.contains('is-loading')).toBe(false)
    expect(again.classList.contains('is-broken')).toBe(true)
  })
  test('shows itself when it loads after all', () => {
    const doc = 'words\n\n![](later.png)\n\nend'
    frameOf(doc).querySelector('img')?.dispatchEvent(new Event('error'))
    const again = frameOf(doc)
    expect(again.classList.contains('is-broken')).toBe(true)
    again.querySelector('img')?.dispatchEvent(new Event('load'))
    expect(again.classList.contains('is-broken')).toBe(false)
    expect(frameOf(doc).classList.contains('is-broken')).toBe(false)
  })
})
