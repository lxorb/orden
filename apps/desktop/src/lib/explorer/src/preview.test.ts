import { describe, expect, test } from 'vitest'
import { MOST_MEDIA, shownAs, textOf } from './preview'

describe("a file explorer's preview", () => {
  test('knows a picture, a sound and a film by their names, and reads the rest as text', () => {
    expect(shownAs('photo.JPG', 10)).toBe('picture')
    expect(shownAs('song.mp3', 10)).toBe('sound')
    expect(shownAs('clip.webm', 10)).toBe('film')
    expect(shownAs('notes.txt', 10)).toBe('text')
    expect(shownAs('huge.mp4', MOST_MEDIA + 1)).toBeNull()
  })

  test('shows words only where the bytes are words', () => {
    expect(textOf(new TextEncoder().encode('Grüße'))).toBe('Grüße')
    expect(textOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]))).toBeNull()
    expect(textOf(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull()
  })

  test('keeps the words of a file cut in the middle of a letter', () => {
    const whole = new TextEncoder().encode(`${'a'.repeat(64 * 1024 - 1)}ü`)
    expect(textOf(whole.subarray(0, 64 * 1024))).toBe('a'.repeat(64 * 1024 - 1))
  })
})
