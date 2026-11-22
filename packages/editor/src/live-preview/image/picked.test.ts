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

const DOC = 'words\n\n![A cat](cat.png)\n\nend'
const open: EditorView[] = []
beforeAll(() => noRects())
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function shown(): { view: EditorView; frame: HTMLElement } {
  const view = new EditorView({
    state: parsed(
      EditorState.create({
        doc: DOC,
        selection: EditorSelection.cursor(DOC.length),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), livePreview()],
      }),
    ),
    parent: document.body,
  })
  open.push(view)
  const frame = view.contentDOM.querySelector<HTMLElement>('.orden-image-frame')
  if (!frame) throw new Error('no picture drawn')
  return { view, frame }
}
function press(frame: HTMLElement) {
  const event = new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  frame.dispatchEvent(event)
}
const picked = (view: EditorView) => view.dom.classList.contains('orden-picture-picked')
describe('a picked picture', () => {
  test('is the whole selection, and the editor hides its caret while it is picked', () => {
    const { view, frame } = shown()
    expect(picked(view)).toBe(false)
    press(frame)
    const { from, to } = view.state.selection.main
    expect(view.state.sliceDoc(from, to)).toBe('![A cat](cat.png)')
    expect(picked(view)).toBe(true)
    view.dispatch({ selection: { anchor: 0 } })
    expect(picked(view)).toBe(false)
  })
  test('has no field to describe it, and keeps its size, open, link, source and delete', () => {
    const { frame } = shown()
    const tools = frame.querySelector('.orden-image-tools')
    expect(tools?.querySelector('input')).toBeNull()
    expect(tools?.textContent).not.toContain('Describe')
    const named = [...(tools?.querySelectorAll('button') ?? [])].map((one) =>
      one.className.replace('orden-image-tool ', ''),
    )
    expect(named).toEqual([
      'orden-image-size',
      'orden-image-open',
      'orden-image-copy',
      'orden-image-source',
      'orden-image-delete',
    ])
  })
})
