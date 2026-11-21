import { describe, expect, test } from 'vitest'
import { changed, glyph, LOOKS, MOODS } from './faces'

const parts = ['eyes', 'mouth', 'arms', 'prop'] as const

describe('the faces', () => {
  test('keep the moods the import tab names', () => {
    expect(glyph(LOOKS.happy.rest)).toBe('( ͡° ͜ʖ ͡°)')
    expect(glyph(LOOKS.unsure.rest)).toBe('( ͡° ʖ̯ ͡°)')
    expect(glyph(LOOKS.crying.rest)).toBe('( ͡ಥ ͜ʖ ͡ಥ)')
    expect(glyph(changed(LOOKS.crying.rest, LOOKS.crying.moves[0]![0]!.change))).toBe('( ͡ಥ ʖ̯ ͡ಥ)')
  })
  test('wear their arms around the face', () => {
    expect(glyph(LOOKS.shrug.rest)).toBe('¯\\_( ͡° ͜ʖ ͡°)_/¯')
    expect(glyph(LOOKS.hug.rest)).toBe('(づ ͡° ͜ʖ ͡°)づ')
  })
  test.each(MOODS)('%s changes one thing at a time and always moves', (mood) => {
    const look = LOOKS[mood]
    expect(look.moves.length).toBeGreaterThan(0)
    for (const frames of look.moves) {
      expect(frames.length).toBeGreaterThan(0)
      for (const frame of frames) {
        const moved = parts.filter(
          (part) => part in frame.change && JSON.stringify(frame.change[part]) !== JSON.stringify(look.rest[part]),
        )
        expect(moved.length).toBeLessThanOrEqual(1)
        expect(frame.ms).toBeGreaterThan(0)
        expect(frame.ms).toBeLessThanOrEqual(1500)
      }
      expect(frames.some((frame) => Object.keys(frame.change).length > 0)).toBe(true)
    }
  })
  test('every mood looks different at rest', () => {
    const rests = MOODS.map((mood) => JSON.stringify([glyph(LOOKS[mood].rest), LOOKS[mood].rest.prop]))
    expect(new Set(rests).size).toBe(MOODS.length)
  })
})
