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
  // An empty line's caret has no box, and the foot of the note is another block.
  test('on an empty line asks from that line, not from the foot of what has the keyboard', () => {
    const note = document.createElement('div')
    note.contentEditable = 'true'
    note.tabIndex = 0
    const line = document.createElement('div')
    line.append(document.createElement('br'))
    note.append(line)
    document.body.append(note)
    note.getBoundingClientRect = () => new DOMRect(0, 0, 600, 800)
    line.getBoundingClientRect = () => new DOMRect(0, 100, 600, 20)
    note.focus()
    getSelection()?.collapse(line, 0)

    const heard: MouseEvent[] = []
    note.addEventListener('contextmenu', (event) => heard.push(event))
    macMenuKey(key({ key: 'ContextMenu' }))

    expect(heard[0]?.clientY).toBeGreaterThan(100)
    expect(heard[0]?.clientY).toBeLessThan(120)
  })

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
