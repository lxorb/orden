import { describe, expect, test } from 'vitest'
import { cursorFor, type Look, nibCursor, rubCursor } from './cursor'

/** What the pointer says. A mouse hand should never have to look at the bar to know
 *  what a press will do, so every tool and everything under the pointer has an
 *  answer, and the two drawn ones are drawn at the size the tool really is. */

function look(over: Partial<Look> = {}): Look {
  return {
    tool: 'select',
    busy: false,
    holding: false,
    over: null,
    nib: { size: 3, colour: '#112233' },
    rub: { size: 10, whole: false },
    ...over,
  }
}

describe('what the pointer says', () => {
  test('is the arrow over the plane with the arrow in hand', () => {
    expect(cursorFor(look())).toBe('default')
  })

  test('is a hand that closes when it is moving the page', () => {
    expect(cursorFor(look({ tool: 'hand' }))).toBe('grab')
    expect(cursorFor(look({ tool: 'hand', busy: true }))).toBe('grabbing')
  })

  test('is a hand while space is held, whatever the bar is holding', () => {
    expect(cursorFor(look({ tool: 'draw', holding: true }))).toBe('grab')
    expect(cursorFor(look({ tool: 'draw', holding: true, busy: true }))).toBe('grabbing')
  })

  test('is a crosshair for the lasso and for everything a press puts down', () => {
    expect(cursorFor(look({ tool: 'lasso' }))).toBe('crosshair')
    expect(cursorFor(look({ tool: 'put' }))).toBe('crosshair')
  })

  /** Which way a handle pulls, said by the arrow on it: the one bit of chrome whose
   *  whole job is to be dragged in one direction. */
  test('is the resize arrow that matches the handle under it', () => {
    expect(cursorFor(look({ over: 'se' }))).toBe('nwse-resize')
    expect(cursorFor(look({ over: 'nw' }))).toBe('nwse-resize')
    expect(cursorFor(look({ over: 'ne' }))).toBe('nesw-resize')
    expect(cursorFor(look({ over: 'n' }))).toBe('ns-resize')
    expect(cursorFor(look({ over: 'e' }))).toBe('ew-resize')
  })

  test('is a pointer over a connector anchor, and a move over a card', () => {
    expect(cursorFor(look({ over: 'port' }))).toBe('pointer')
    expect(cursorFor(look({ over: 'thing' }))).toBe('move')
  })

  /** A pen does not resize anything, so what is under it does not change what it is. */
  test('is still the nib over a handle, because a pen cannot resize a card', () => {
    expect(cursorFor(look({ tool: 'draw', over: 'se' }))).toContain('data:image/svg+xml')
  })

  test('is a drawn dot for the pen and a drawn ring for the eraser', () => {
    expect(cursorFor(look({ tool: 'draw' }))).toContain('data:image/svg+xml')
    expect(cursorFor(look({ tool: 'erase' }))).toContain('data:image/svg+xml')
  })
})

describe('the pen’s own dot', () => {
  test('carries the pen’s colour, so which pen is in hand is never a guess', () => {
    expect(nibCursor(8, '#ff0000')).toContain(encodeURIComponent('#ff0000'))
  })

  /** A colour is whatever a file said it was, and a canvas may have arrived from a
   *  room, a share or a paste: what a file called a colour must never be able to end
   *  the attribute it is written into. */
  test('cannot be broken out of by a colour a file made up', () => {
    const cursor = nibCursor(8, '#f00" onload="alert(1)')
    expect(cursor).not.toContain(encodeURIComponent('onload="'))
  })

  test('grows with the nib, and stops before a browser would refuse to draw it', () => {
    const fine = nibCursor(2, '#000')
    const fat = nibCursor(20, '#000')
    expect(sizeOf(fat)).toBeGreaterThan(sizeOf(fine))
    expect(sizeOf(nibCursor(4000, '#000'))).toBeLessThanOrEqual(128)
  })

  test('has a hotspot in the middle of itself, which is where the nib is', () => {
    const cursor = nibCursor(10, '#000')
    const [, x, y] = /(\d+) (\d+), crosshair$/.exec(cursor) ?? []
    expect(Number(x)).toBe(sizeOf(cursor) / 2)
    expect(Number(y)).toBe(sizeOf(cursor) / 2)
  })
})

describe('the eraser’s own ring', () => {
  /** The whole point of drawing it: the ring on screen is the hole it will rub, so
   *  nothing has to be read off a number and imagined. */
  test('is as wide on screen as the hole it will rub', () => {
    expect(sizeOf(rubCursor({ size: 10, whole: false }))).toBe(24)
    expect(sizeOf(rubCursor({ size: 30, whole: false }))).toBe(64)
  })

  test('follows the width dial while it is still moving', () => {
    const narrow = rubCursor({ size: 6, whole: false })
    const wide = rubCursor({ size: 40, whole: false })
    expect(sizeOf(wide)).toBeGreaterThan(sizeOf(narrow))
  })

  /** A stroke eraser takes whatever line it touches, whole, so it has no width to
   *  show and says so with a dashed ring at a fixed size instead. */
  test('is a small dashed ring for the eraser that takes whole strokes', () => {
    const whole = rubCursor({ size: 40, whole: true })
    expect(whole).toContain(encodeURIComponent('stroke-dasharray'))
    expect(sizeOf(whole)).toBeLessThan(sizeOf(rubCursor({ size: 40, whole: false })))
  })

  test('stops before a browser would refuse to draw it', () => {
    expect(sizeOf(rubCursor({ size: 500, whole: false }))).toBeLessThanOrEqual(128)
  })
})

/** How wide the drawn cursor is, read back out of the SVG it is made of. */
function sizeOf(cursor: string): number {
  const found = /width%3D%22(\d+)%22/.exec(cursor)
  return Number(found?.[1] ?? 0)
}
