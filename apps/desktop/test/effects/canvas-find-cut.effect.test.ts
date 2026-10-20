import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { emptyCanvas, readCanvas, writeCanvas } from '../../src/lib/canvas/format'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'

/** A cut in the find field, after Enter has picked the card it found (#535).
 *
 *  The plane hears the clipboard on its whole host, and the find field is inside
 *  it, so the cut bubbled up to the plane: the field kept its words and the card
 *  it had found went, edges and all. What is cut in a field is the field's.
 *
 *  In the jsdom project because it mounts a component and dispatches real events. */

/** The plane measures its pane through a ResizeObserver, which jsdom has not got. */
class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})

test('a cut in the find field leaves the card it found on the plane', () => {
  const text = writeCanvas({
    ...emptyCanvas(),
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'invoice' },
      { id: 'b', type: 'text', x: 0, y: 100, width: 250, height: 60, text: 'receipt' },
    ],
  })
  const note = new NoteDoc(
    { kind: 'canvas', path: '/space/Board.canvas', name: 'Board.canvas', text, dirty: false },
    () => undefined,
  )
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Canvas, { target, props: { tab: new Tab(note, 'pane'), focused: true } })
  close = () => void unmount(shown, { outro: false })
  flushSync()

  const host = target.querySelector<HTMLElement>('.canvas')
  if (!host) throw new Error('no plane')
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  flushSync()

  const field = target.querySelector<HTMLInputElement>('.find input')
  if (!field) throw new Error('no find field')
  field.value = 'invoice'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  flushSync()

  field.dispatchEvent(new Event('cut', { bubbles: true, cancelable: true }))
  flushSync()
  // The tab going is what writes the plane into its file at once.
  close()
  close = undefined

  expect(readCanvas(note.text).nodes.map((node) => node.id)).toEqual(['a', 'b'])
})
