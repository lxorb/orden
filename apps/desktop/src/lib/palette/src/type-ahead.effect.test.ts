import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TYPED_AHEAD_FOR, TypeAhead } from './type-ahead'

const put: [Element, string, boolean][] = []
let ahead: TypeAhead

function field(tag: 'input' | 'textarea' = 'input', asking = false): HTMLElement {
  const one = document.createElement(tag)
  const box = document.createElement('div')
  if (asking) box.setAttribute('role', 'dialog')
  box.append(one)
  document.body.append(box)
  return one
}

function type(keys: string[]): boolean[] {
  return keys.map((key) => {
    const press = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    ;(document.activeElement ?? document.body).dispatchEvent(press)
    return press.defaultPrevented
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  put.length = 0
  document.body.replaceChildren()
  ahead = new TypeAhead({
    listen: (on, to) => {
      for (const one of ['keydown', 'focusin']) {
        if (on) window.addEventListener(one, to, true)
        else window.removeEventListener(one, to, true)
      }
    },
    focused: () => document.activeElement,
    put: (into, text, enter) => put.push([into, text, enter]),
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what is typed while a command opens what it asks with', () => {
  test('goes into the field it opened, with the Enter after it', () => {
    const palette = field()
    palette.focus()
    ahead.hold(palette)

    expect(type(['C', 'h', 'a', 't', 'Enter'])).toEqual([true, true, true, true, true])
    const asked = field('input', true)
    asked.focus()

    expect(put).toEqual([[asked, 'Chat', true]])
  })

  test('goes into a field that took the keyboard unannounced, and lets the next key through', () => {
    const deaf = new TypeAhead({
      listen: (on, to) => {
        if (on) window.addEventListener('keydown', to, true)
        else window.removeEventListener('keydown', to, true)
      },
      focused: () => document.activeElement,
      put: (into, text, enter) => put.push([into, text, enter]),
    })
    const palette = field()
    palette.focus()
    deaf.hold(palette)
    type(['a', 'b'])
    const asked = field('input', true)
    asked.focus()

    expect(type(['c'])).toEqual([false])
    expect(put).toEqual([[asked, 'ab', false]])
  })

  test('goes into the palette opened again before it had gone, and holds nothing after', () => {
    const palette = field()
    palette.focus()
    ahead.hold(palette)
    type(['x'])

    ahead.letGo(palette)

    expect(put).toEqual([[palette, 'x', false]])
    expect(type(['E'])).toEqual([false])
  })

  test('goes into the note the keyboard came back to, once nothing else asked for it', () => {
    const palette = field()
    palette.focus()
    ahead.hold(palette)
    const note = field('textarea')
    note.focus()

    type(['h', 'i', 'x', 'Backspace'])
    expect(put).toEqual([])

    vi.advanceTimersByTime(TYPED_AHEAD_FOR)
    expect(put).toEqual([[note, 'hi', false]])
    expect(type(['!'])).toEqual([false])
  })

  test('lets a shortcut through, and a key pressed outside anything typable, and holds nothing when a field already has the keyboard', () => {
    const palette = field()
    palette.focus()
    ahead.hold(palette)
    const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    window.dispatchEvent(shortcut)
    expect(shortcut.defaultPrevented).toBe(false)

    const canvas = document.createElement('div')
    canvas.tabIndex = 0
    document.body.append(canvas)
    canvas.focus()
    expect(type(['d', 'v'])).toEqual([false, false])

    const renaming = field()
    renaming.focus()
    ahead.hold(palette)
    expect(type(['a'])).toEqual([false])
  })
})
