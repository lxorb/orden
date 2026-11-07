import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { roving } from './roving'

const HELD: Record<string, KeyboardEventInit> = {
  'a Mac’s Cmd+Shift': { metaKey: true, shiftKey: true },
  'a Mac’s Cmd': { metaKey: true },
  'Ctrl, elsewhere': { ctrlKey: true },
  'Ctrl+Shift': { ctrlKey: true, shiftKey: true },
  Alt: { altKey: true },
  nothing: {},
}

let list: HTMLElement
let handle: { destroy?: () => void }
let chosen: string[]

function rows(): HTMLButtonElement[] {
  return [...list.querySelectorAll<HTMLButtonElement>('.orden-row')]
}

function press(key: string, held: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held })
  ;(document.activeElement ?? list).dispatchEvent(event)
  return event
}

const standing = () => document.activeElement?.textContent

function mount(held: boolean) {
  list = document.createElement('div')
  for (const name of ['Work', 'Food', 'Uni']) {
    const row = document.createElement('button')
    row.className = name === 'Food' ? 'orden-row is-on' : 'orden-row'
    row.textContent = name
    row.addEventListener('click', () => chosen.push(name))
    list.append(row)
  }
  document.body.append(list)
  handle = roving(list, { current: '.is-on', wrap: true, held })
  rows()[1]?.focus()
}

beforeEach(() => {
  chosen = []
  HTMLElement.prototype.scrollIntoView = () => undefined
})

afterEach(() => {
  handle.destroy?.()
  list.remove()
})

describe('a layer opened by a chord', () => {
  for (const [name, held] of Object.entries(HELD)) {
    test(`walks and chooses with ${name} held`, () => {
      mount(true)
      expect(standing()).toBe('Food')

      expect(press('ArrowDown', held).defaultPrevented).toBe(true)
      expect(standing()).toBe('Uni')
      press('ArrowDown', held)
      expect(standing()).toBe('Work')
      press('ArrowUp', held)
      expect(standing()).toBe('Uni')
      press('Home', held)
      expect(standing()).toBe('Work')
      press('End', held)
      expect(standing()).toBe('Uni')

      expect(press('Enter', held).defaultPrevented).toBe(true)
      expect(chosen).toEqual(['Uni'])
    })
  }

  test('leaves Space under the chord to the window, which puts the layer away', () => {
    mount(true)
    const event = press(' ', { metaKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(false)
    expect(chosen).toEqual([])
    expect(press(' ', { ctrlKey: true }).defaultPrevented).toBe(false)
  })
})

describe('any other list', () => {
  test('leaves an arrow and Enter under Ctrl, Alt or Cmd to the window', () => {
    mount(false)
    for (const held of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      expect(press('ArrowDown', held).defaultPrevented).toBe(false)
      expect(press('Enter', held).defaultPrevented).toBe(false)
    }
    expect(standing()).toBe('Food')
    expect(chosen).toEqual([])
  })
})
