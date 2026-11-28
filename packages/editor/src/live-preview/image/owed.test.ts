// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../../test/parsed'
import { noRects } from '../../../test/views'
import { ordenMarkdownExtensions } from '../../markdown/extensions'
import { imageNotes, type ImageNotes, imageResolver } from '../../images'
import { livePreview } from '..'

const DOC = 'words\n\n![](https://orden.so/i/aa.png)\n\nend'
const open: EditorView[] = []
beforeAll(() => noRects())
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function noted() {
  const notes = new Map<string, string>()
  const listeners = new Set<() => void>()
  const told: ImageNotes = {
    note: (address) => notes.get(address) ?? null,
    heard: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const say = (address: string, note: string | null) => {
    if (note === null) notes.delete(address)
    else notes.set(address, note)
    for (const listener of [...listeners]) listener()
  }
  return { told, say, listeners }
}
function shown(told: ImageNotes, holder = new Compartment()): EditorView {
  const view = new EditorView({
    state: parsed(
      EditorState.create({
        doc: DOC,
        selection: EditorSelection.cursor(DOC.length),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          livePreview(),
          imageResolver.of(() => 'blob:held'),
          holder.of(imageNotes.of(told)),
        ],
      }),
    ),
    parent: document.body,
  })
  open.push(view)
  return view
}
const frameOf = (view: EditorView) => view.contentDOM.querySelector<HTMLElement>('.orden-image-frame')
describe('a picture not yet uploaded', () => {
  test('wears a quiet mark while it is owed and loses it once it lands, in the same frame', () => {
    const { told, say } = noted()
    const view = shown(told)
    const frame = frameOf(view)
    expect(frame?.classList.contains('is-owed')).toBe(false)
    say('blob:held', 'Not uploaded yet')
    expect(frameOf(view)).toBe(frame)
    expect(frame?.classList.contains('is-owed')).toBe(true)
    expect(frame?.querySelector('.orden-image-owed')?.getAttribute('title')).toBe('Not uploaded yet')
    say('blob:held', null)
    expect(frameOf(view)).toBe(frame)
    expect(frame?.classList.contains('is-owed')).toBe(false)
    expect(frame?.querySelector('.orden-image-owed')).toBeNull()
  })
  test('stops being listened for when the note is closed or its notes are swapped', () => {
    const first = noted()
    const holder = new Compartment()
    const view = shown(first.told, holder)
    expect(first.listeners.size).toBe(1)
    const second = noted()
    view.dispatch({ effects: holder.reconfigure(imageNotes.of(second.told)) })
    expect(first.listeners.size).toBe(0)
    expect(second.listeners.size).toBe(1)
    open.splice(open.indexOf(view), 1)
    view.destroy()
    expect(second.listeners.size).toBe(0)
  })
})
