import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { macMenuKey } from '../../src/lib/system-menu'

/** The menu key on a Mac, whose engine makes no `contextmenu` of it. In the effects project
 *  for a document with something in it to have the keyboard. */

const key = (init: KeyboardEventInit) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

function holding(tag: string) {
  const held = document.createElement(tag)
  held.tabIndex = 0
  document.body.append(held)
  held.focus()
  const heard: Event[] = []
  held.addEventListener('contextmenu', (event) => heard.push(event))
  return heard
}

// jsdom lays nothing out, and has no box for a range to answer with.
beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('a menu key on a Mac', () => {
  test.each([{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }])(
    'asks what has the keyboard for its menu: %o',
    (init) => {
      const heard = holding('div')
      const pressed = key(init)
      expect(macMenuKey(pressed)).toBe(true)
      expect(heard).toHaveLength(1)
      expect(pressed.defaultPrevented).toBe(true)
    },
  )

  test('leaves a key alone that something took, as a row in a list does', () => {
    const heard = holding('div')
    const pressed = key({ key: 'ContextMenu' })
    pressed.preventDefault()
    expect(macMenuKey(pressed)).toBe(true)
    expect(heard).toHaveLength(0)
  })

  test('is not F10 alone, nor any other key', () => {
    const heard = holding('textarea')
    expect(macMenuKey(key({ key: 'F10' }))).toBe(false)
    expect(macMenuKey(key({ key: 'a' }))).toBe(false)
    expect(heard).toHaveLength(0)
  })
})
