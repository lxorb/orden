// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { sidebarKey, used } from './undo.svelte'

/** Whose Ctrl+Z it is (#399): the sidebar's where the sidebar was the last thing
 *  pressed or typed in, wherever the keyboard went since, but in a field; and the
 *  press goes on to whatever has the keyboard otherwise. */

document.body.innerHTML = `
  <aside data-sidebar><ul><li><button class="row">Plan</button></li></ul></aside>
  <div data-panes>
    <div class="cm-editor"><div contenteditable="true" class="note"></div></div>
    <textarea></textarea><canvas></canvas>
  </div>
  <div role="menu"><button class="item">Delete</button></div>
`
function $(selector: string): Element {
  const found = document.querySelector(selector)
  if (!found) throw new Error(`nothing is ${selector}`)
  return found
}

/** A key pressed on `target`; `held` is what the table would say it is. */
function press(target: Element, held: string | null, prevented = false) {
  const event = new KeyboardEvent('keydown', { key: 'z', cancelable: true, bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  if (prevented) event.preventDefault()
  return sidebarKey(event, (id) => id === held)
}

beforeEach(() => used($('canvas')))

describe('a press of Undo', () => {
  test('after a row was pressed is the sidebar’s, with the keyboard gone to nothing', () => {
    used($('.row'))
    expect(press(document.body, 'edit.undo')).toBe('undo')
    expect(press(document.body, 'edit.redo')).toBe('redo')
    expect(press(document.body, 'edit.redo.alt')).toBe('redo')
  })

  test('and a menu pressed on the way, Delete in a row’s, leaves it the sidebar’s', () => {
    used($('.row'))
    used($('.item'))
    expect(press(document.body, 'edit.undo')).toBe('undo')
  })

  test('is a field’s while a field holds the keyboard', () => {
    used($('.row'))
    expect(press($('textarea'), 'edit.undo')).toBeNull()
  })

  test('is the sidebar’s in a note the app gave the keyboard to', () => {
    used($('.row'))
    expect(press($('.note'), 'edit.undo')).toBe('undo')
  })

  test('and the note’s once the note was pressed', () => {
    used($('.row'))
    used($('.note'))
    expect(press($('.note'), 'edit.undo')).toBeNull()
  })

  test('is nobody’s once something else was pressed, or something took it already', () => {
    used($('.row'))
    used($('canvas'))
    expect(press(document.body, 'edit.undo')).toBeNull()

    used($('.row'))
    expect(press($('.row'), 'edit.undo', true)).toBeNull()
  })

  test('and typing in the note since takes it back from the sidebar', () => {
    used($('.row'))
    expect(press($('.note'), null)).toBeNull()
    expect(press(document.body, 'edit.undo')).toBeNull()
  })
})
