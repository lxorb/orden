import { describe, expect, test } from 'vitest'
import {
  displayPoint,
  drivesPointer,
  HeldKeys,
  keyEvent,
  pointerStyle,
  textEvent,
  wheelClicks,
} from './input'

/** What the holder does over an application's picture, as its host is sent it (issue
 *  1063, steps 4 and 5; input.ts), and the application's pointer as the tab draws it. */

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height }) as DOMRectReadOnly

describe('the point under the pointer', () => {
  test('is the display’s own pixel, through the scale the picture is drawn at', () => {
    // A 2560 by 1600 display in a pane of 1280 by 800 CSS pixels: two to one.
    expect(displayPoint(100, 50, box(0, 0, 1280, 800), 2560, 1600)).toEqual({ x: 200, y: 100 })
  })

  test('leaves out the bands round a picture of another shape, and keeps to the display', () => {
    // A square display in a wide pane is drawn in its middle.
    expect(displayPoint(400, 300, box(0, 0, 800, 600), 600, 600)).toEqual({ x: 300, y: 300 })
    expect(displayPoint(10, 300, box(0, 0, 800, 600), 600, 600)).toEqual({ x: 0, y: 300 })
    expect(displayPoint(799, 599, box(0, 0, 800, 600), 600, 600)).toEqual({ x: 599, y: 599 })
  })

  test('is nowhere before the picture has a size', () => {
    expect(displayPoint(1, 1, box(0, 0, 800, 600), 0, 0)).toBeNull()
  })
})

describe('the wheel', () => {
  test('makes a click a notch, and keeps what is left over for the next turn', () => {
    const first = wheelClicks({ x: 0, y: 0 }, 0, 150, 0)
    expect(first).toEqual({ x: 0, y: 1, left: { x: 0, y: 0.5 } })
    const second = wheelClicks(first.left, -30, 60, 0)
    expect(second.y).toBe(1)
    expect(second.x).toBe(0)
    expect(second.left.y).toBeCloseTo(0.1)
    expect(second.left.x).toBeCloseTo(-0.3)
  })

  test('counts lines three to a click', () => {
    expect(wheelClicks({ x: 0, y: 0 }, 0, -6, 1)).toEqual({ x: 0, y: -2, left: { x: 0, y: 0 } })
  })
})

describe('a key', () => {
  test('is sent by what it gave and the key it was', () => {
    expect(keyEvent({ key: 'ä', code: 'Quote', isComposing: false }, true)).toEqual({
      t: 'key',
      key: 'ä',
      code: 'Quote',
      down: true,
    })
  })

  test('is not pressed mid-composition or when the engine cannot name it, but always let go', () => {
    expect(keyEvent({ key: 'a', code: 'KeyA', isComposing: true }, true)).toBeNull()
    expect(keyEvent({ key: 'Dead', code: 'BracketLeft', isComposing: false }, true)).toBeNull()
    expect(keyEvent({ key: 'Dead', code: 'BracketLeft', isComposing: false }, false)).toEqual({
      t: 'key',
      key: 'Dead',
      code: 'BracketLeft',
      down: false,
    })
  })
})

describe('an input method', () => {
  test('its text is typed as it is, once chosen; nothing chosen is nothing typed', () => {
    expect(textEvent('日本語')).toEqual({ t: 'text', text: '日本語' })
    expect(textEvent('')).toBeNull()
    expect(textEvent(null)).toBeNull()
  })
})

describe('a pointer', () => {
  test('of a mouse, a pen or the first finger drives the application; a second does not', () => {
    expect(drivesPointer({ isPrimary: true })).toBe(true)
    expect(drivesPointer({ isPrimary: false })).toBe(false)
  })
})

describe('the keys held', () => {
  test('are let go when the tab loses the keyboard, once', () => {
    const held = new HeldKeys()
    held.saw({ t: 'key', key: 'Alt', code: 'AltLeft', down: true })
    held.saw({ t: 'key', key: 'a', code: 'KeyA', down: true })
    held.saw({ t: 'key', key: 'a', code: 'KeyA', down: false })
    held.saw({ t: 'move', x: 1, y: 1 })
    expect(held.letGo()).toEqual([{ t: 'key', key: '', code: 'AltLeft', down: false }])
    expect(held.letGo()).toEqual([])
  })
})

describe('the application’s pointer', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='

  test('is drawn at the tab’s ratio, its hot spot in CSS pixels', () => {
    expect(pointerStyle({ t: 'pointer', png, x: 8, y: 16 }, 2)).toBe(
      `-webkit-image-set(url("${png}") 2x) 4 8, default`,
    )
    expect(pointerStyle({ t: 'pointer', png, x: 3, y: 5 }, 1)).toBe(
      `-webkit-image-set(url("${png}") 1x) 3 5, default`,
    )
  })

  test('hidden is none, and unsaid is the engine’s own', () => {
    expect(pointerStyle({ t: 'pointer', hidden: true }, 2)).toBe('none')
    expect(pointerStyle(null, 2)).toBe('')
  })
})
