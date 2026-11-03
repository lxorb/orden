import { describe, expect, test } from 'vitest'
import {
  dataUrlOf,
  type Drawing,
  fitWithin,
  LONGEST_EDGE,
  MOST_PICTURE_BYTES,
  picturesAmong,
  redrawn,
  writtenAs,
} from './feedback-pictures'

/** The pictures a report carries (#1087): drawn afresh no larger than the service takes,
 *  as a PNG where they came without loss and as a JPEG otherwise, and made smaller until
 *  they fit. */

/** A canvas that writes `bytes(width, height, type)` bytes for each try, and says what
 *  it was asked. */
function fake(
  size: { width: number; height: number } | null,
  bytes: (width: number, height: number, type: string) => number,
) {
  const asked: string[] = []
  let closed = false
  const drawing: Drawing = {
    open: () => Promise.resolve(size),
    write: (width, height, type) => {
      asked.push(`${String(width)}x${String(height)} ${type}`)
      return Promise.resolve(new Blob([new Uint8Array(bytes(width, height, type))], { type }))
    },
    close: () => {
      closed = true
    },
  }
  return { drawing, asked, closed: () => closed }
}

describe('a picture for a report', () => {
  test('is drawn no longer than the longest edge, and never larger than it is', () => {
    expect(fitWithin(4800, 2400, LONGEST_EDGE)).toEqual({ width: 2400, height: 1200 })
    expect(fitWithin(800, 600, LONGEST_EDGE)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1, 10_000, 100)).toEqual({ width: 1, height: 100 })
  })

  test('stays a PNG where it came without loss, and a photograph a JPEG', () => {
    expect(writtenAs('image/png')).toBe('image/png')
    expect(writtenAs('image/webp')).toBe('image/png')
    expect(writtenAs('image/gif')).toBe('image/png')
    expect(writtenAs('image/jpeg')).toBe('image/jpeg')
    expect(writtenAs('image/heic')).toBe('image/jpeg')
  })

  test('is only what says it is a picture', () => {
    const files = [
      new File(['a'], 'shot.png', { type: 'image/png' }),
      new File(['b'], 'notes.txt', { type: 'text/plain' }),
    ]
    expect(picturesAmong(files).map((one) => one.name)).toEqual(['shot.png'])
  })

  test('that fits as it came goes as it came', async () => {
    const { drawing, asked, closed } = fake({ width: 1200, height: 800 }, () => 1000)
    const drawn = await redrawn(new Blob([], { type: 'image/png' }), drawing)
    expect(drawn?.type).toBe('image/png')
    expect(asked).toEqual(['1200x800 image/png'])
    expect(closed()).toBe(true)
  })

  test('that does not is written as a JPEG, smaller each time, until it fits', async () => {
    const { drawing, asked } = fake({ width: 5000, height: 2500 }, (width, _height, type) =>
      type === 'image/png' || width > 1400 ? MOST_PICTURE_BYTES + 1 : 10,
    )
    const drawn = await redrawn(new Blob([], { type: 'image/png' }), drawing)
    expect(drawn?.type).toBe('image/jpeg')
    expect(drawn?.blob.size).toBeLessThanOrEqual(MOST_PICTURE_BYTES)
    expect(asked).toEqual([
      '2400x1200 image/png',
      '2400x1200 image/jpeg',
      '1800x900 image/jpeg',
      '1400x700 image/jpeg',
    ])
  })

  test('is refused where it will not fit however small, or cannot be drawn', async () => {
    const huge = fake({ width: 3000, height: 3000 }, () => MOST_PICTURE_BYTES + 1)
    expect(await redrawn(new Blob([], { type: 'image/png' }), huge.drawing)).toBeNull()
    expect(huge.closed()).toBe(true)

    const unreadable = fake(null, () => 1)
    expect(await redrawn(new Blob([], { type: 'image/png' }), unreadable.drawing)).toBeNull()
  })

  test('goes as the data URL the service reads', async () => {
    const url = await dataUrlOf(new Blob([new Uint8Array([137, 80, 78, 71])]), 'image/png')
    expect(url).toBe('data:image/png;base64,iVBORw==')
  })
})
