import { describe, expect, test } from 'vitest'
import { foldsKeyboard } from './editor-states'

function editor(empty = true, composing = false) {
  const scrollDOM = document.createElement('div')
  const contentDOM = document.createElement('div')
  contentDOM.tabIndex = 0
  scrollDOM.append(contentDOM)
  document.body.append(scrollDOM)
  contentDOM.focus()
  const view = {
    scrollDOM,
    contentDOM,
    composing,
    state: { selection: { main: { empty } } },
    get hasFocus() {
      return document.activeElement === contentDOM
    },
  }
  const stop = foldsKeyboard(view)
  return { view, stop, done: () => scrollDOM.remove() }
}
function drag(target: HTMLElement, from: number, to: number) {
  const touch = (kind: string, y: number) => {
    const event = new Event(kind, { bubbles: true })
    Object.defineProperty(event, 'touches', { value: kind === 'touchend' ? [] : [{ clientY: y }] })
    target.dispatchEvent(event)
  }
  touch('touchstart', from)
  for (let y = from; from < to ? y <= to : y >= to; y += from < to ? 8 : -8) touch('touchmove', y)
  touch('touchend', to)
}
describe('a note on a touch screen', () => {
  test('folds the keyboard away when its words are dragged down to scroll up', () => {
    const { view, done } = editor()
    drag(view.scrollDOM, 100, 160)
    expect(view.hasFocus).toBe(false)
    done()
  })
  test('keeps the keyboard when scrolled down, or moved only a little', () => {
    const { view, done } = editor()
    drag(view.scrollDOM, 200, 120)
    expect(view.hasFocus).toBe(true)
    drag(view.scrollDOM, 100, 112)
    expect(view.hasFocus).toBe(true)
    done()
  })
  test('keeps the keyboard while words are picked or still being composed', () => {
    const picked = editor(false)
    drag(picked.view.scrollDOM, 100, 160)
    expect(picked.view.hasFocus).toBe(true)
    picked.done()
    const composing = editor(true, true)
    drag(composing.view.scrollDOM, 100, 160)
    expect(composing.view.hasFocus).toBe(true)
    composing.done()
  })
  test('lets go of the screen once the editor goes', () => {
    const { view, stop, done } = editor()
    stop()
    drag(view.scrollDOM, 100, 160)
    expect(view.hasFocus).toBe(true)
    done()
  })
})
