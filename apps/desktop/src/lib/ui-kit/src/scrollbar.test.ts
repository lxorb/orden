import { describe, expect, test } from 'vitest'
import { contentPerThumb, thumbFor, type Track } from './scrollbar'

function track(patch: Partial<Track> = {}): Track {
  return { content: 1600, visible: 400, at: 0, track: 400, least: 28, ...patch }
}

describe('the thumb', () => {
  test.each([
    [{}, { size: 100, offset: 0 }],
    [{ content: 400 }, null],
    [{ content: 401 }, null],
    [{ content: 404, slack: 4 }, null],
    [{ content: 405, slack: 4 }, null],
    [{ at: 1200 }, { size: 100, offset: 300 }],
    [{ at: 600 }, { size: 100, offset: 150 }],
    [{ at: -80 }, { size: 100, offset: 0 }],
    [{ at: 4000 }, { size: 100, offset: 300 }],
    [{ content: 400_000 }, { size: 28, offset: 0 }],
    [
      { content: 400_000, at: 399_600 },
      { size: 28, offset: 372 },
    ],
    [{ track: 20 }, { size: 20, offset: 0 }],
    [{ track: 0 }, null],
  ])(
    'over %o is the share of the bar the screen is, flush at the ends, never too small or too long, and none when it fits',
    (patch, shape) => {
      expect(thumbFor(track(patch))).toEqual(shape)
    },
  )

  test('shows once more than the scroller’s own padding runs past', () => {
    expect(thumbFor(track({ content: 432, slack: 4 }))).not.toBeNull()
  })
})

describe('dragging the thumb', () => {
  test.each([
    [{}, 4],
    [{ track: 20 }, 0],
    [{ content: 400 }, 0],
  ])(
    'over %o moves the content by the same share, or nothing when there is nothing to move',
    (patch, share) => {
      expect(contentPerThumb(track(patch))).toBe(share)
    },
  )
})
