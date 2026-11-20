import { afterEach, describe, expect, test } from 'vitest'
import { caretAfterPaint } from '../../src/lib/app-support'
import { settle } from './settle'

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))
let editor: HTMLTextAreaElement
let strip: HTMLButtonElement
afterEach(() => document.body.replaceChildren())
function world() {
  editor = document.createElement('textarea')
  strip = document.createElement('button')
  document.body.append(strip, editor)
  strip.focus()
  let taken = 0
  const stop = caretAfterPaint(() => {
    taken++
    if (document.activeElement !== editor) editor.focus()
  })
  return { taken: () => taken, stop }
}
describe('the caret after a tab switch', () => {
  test('is not given in the frame the switch draws, but right after it is painted', async () => {
    const { taken, stop } = world()
    await frame()
    expect(taken()).toBe(0)
    expect(document.activeElement).toBe(strip)
    await settle()
    expect(taken()).toBe(1)
    expect(document.activeElement).toBe(editor)
    stop()
  })
  test('is given at once to a key pressed before then, so the key lands in the new tab', async () => {
    const { taken, stop } = world()
    let landed: Element | null = null
    strip.addEventListener('keydown', () => (landed = document.activeElement))
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))
    expect(landed).toBe(editor)
    expect(taken()).toBe(1)
    await settle()
    expect(taken()).toBe(1)
    stop()
  })
  test('is given to text typed by a method that starts with composition, too', () => {
    const { taken, stop } = world()
    strip.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(document.activeElement).toBe(editor)
    expect(taken()).toBe(1)
    stop()
  })
  test('waits for nothing once the tab it was for is gone', async () => {
    const { taken, stop } = world()
    stop()
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))
    await settle()
    expect(taken()).toBe(0)
    expect(document.activeElement).toBe(strip)
  })
})
