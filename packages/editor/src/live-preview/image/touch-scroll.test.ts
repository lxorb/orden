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
function pointer(type: string, kind: string, y: number, id = 7): Event {
  const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, clientX: 40, clientY: y })
  Object.defineProperties(event, { pointerType: { value: kind }, pointerId: { value: id } })
  return event
}
const picked = (view: EditorView) => !view.state.selection.main.empty
describe('a finger on a picture', () => {
  test('scrolling the note across a picture does not pick it', () => {
    const { view, frame } = shown()
    frame.dispatchEvent(pointer('pointerdown', 'touch', 100))
    frame.dispatchEvent(pointer('pointermove', 'touch', 80))
    frame.dispatchEvent(pointer('pointermove', 'touch', 40))
    frame.dispatchEvent(pointer('pointerup', 'touch', 40))
    expect(picked(view)).toBe(false)
  })
  test('a scroll the browser takes over does not pick it', () => {
    const { view, frame } = shown()
    frame.dispatchEvent(pointer('pointerdown', 'touch', 100))
    frame.dispatchEvent(pointer('pointercancel', 'touch', 100))
    frame.dispatchEvent(pointer('pointerup', 'touch', 100))
    expect(picked(view)).toBe(false)
  })
  test('resting on a picture does not pick it before the finger lifts', () => {
    const { view, frame } = shown()
    frame.dispatchEvent(pointer('pointerdown', 'touch', 100))
    expect(picked(view)).toBe(false)
  })
  test('a tap picks it', () => {
    const { view, frame } = shown()
    frame.dispatchEvent(pointer('pointerdown', 'touch', 100))
    frame.dispatchEvent(pointer('pointermove', 'touch', 102))
    frame.dispatchEvent(pointer('pointerup', 'touch', 102))
    expect(picked(view)).toBe(true)
  })
  test('a mouse still picks it as the button goes down', () => {
    const { view, frame } = shown()
    frame.dispatchEvent(pointer('pointerdown', 'mouse', 100))
    expect(picked(view)).toBe(true)
  })
})
