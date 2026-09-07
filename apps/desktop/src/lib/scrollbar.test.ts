import { describe, expect, test } from 'vitest'
import { contentPerThumb, thumbFor, type Track } from './scrollbar'

/** A note four screens long in a 400 pixel window, unless a test says otherwise. */
function track(patch: Partial<Track> = {}): Track {
  return { content: 1600, visible: 400, at: 0, track: 400, least: 28, ...patch }
}

describe('the thumb', () => {
  test('is as much of the bar as the screen is of the note', () => {
    expect(thumbFor(track())?.size).toBe(100)
  })

  test('has nothing to say when the content fits', () => {
    expect(thumbFor(track({ content: 400 }))).toBeNull()
    expect(thumbFor(track({ content: 401 }))).toBeNull()
  })

  test('starts at the top and ends flush with the bottom', () => {
    expect(thumbFor(track())?.offset).toBe(0)
    expect(thumbFor(track({ at: 1200 }))?.offset).toBe(300)
  })

  test('sits proportionally along the way down', () => {
    expect(thumbFor(track({ at: 600 }))?.offset).toBe(150)
  })

  test('stays inside the bar when a touchpad pulls past either end', () => {
    expect(thumbFor(track({ at: -80 }))?.offset).toBe(0)
    expect(thumbFor(track({ at: 4000 }))?.offset).toBe(300)
  })

  test('is never too small to grab, however long the note', () => {
    const shape = thumbFor(track({ content: 400_000 }))
    expect(shape?.size).toBe(28)
    // And it still reaches the bottom, on the room a shortened thumb leaves.
    expect(thumbFor(track({ content: 400_000, at: 399_600 }))?.offset).toBe(372)
  })

  test('never runs longer than the bar it is in', () => {
    const shape = thumbFor(track({ track: 20, content: 1600 }))
    expect(shape?.size).toBe(20)
    expect(shape?.offset).toBe(0)
  })

  test('a bar with no height at all has no thumb', () => {
    expect(thumbFor(track({ track: 0 }))).toBeNull()
  })
})

describe('dragging the thumb', () => {
  test('moves the content by the same share of it', () => {
    // 300 pixels of room in the bar for 1200 pixels of note.
    expect(contentPerThumb(track())).toBe(4)
  })

  test('moves nothing when the thumb fills the bar', () => {
    expect(contentPerThumb(track({ track: 20 }))).toBe(0)
  })

  test('moves nothing when there is nothing to scroll', () => {
    expect(contentPerThumb(track({ content: 400 }))).toBe(0)
  })
})
