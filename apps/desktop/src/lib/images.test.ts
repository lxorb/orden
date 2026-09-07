import { describe, expect, test } from 'vitest'
import { imagePath } from './images'

const NOTE = '/Notes/Work/Plan.md'

describe('where a picture a note points at lives', () => {
  test('is beside the note when the note names it plainly', () => {
    expect(imagePath('assets/pic.png', NOTE)).toBe('/Notes/Work/assets/pic.png')
  })

  test("is the space's own folder when the note climbs to it", () => {
    // What the default attachment folder writes from a note one level down. The
    // path is folded, so nothing further along has to work the climb out.
    expect(imagePath('../assets/pic.png', NOTE)).toBe('/Notes/assets/pic.png')
    expect(imagePath('../../assets/pic.png', '/Notes/Work/2026/Q1.md')).toBe(
      '/Notes/assets/pic.png',
    )
  })

  test('is a folder whose name has a space in it, however the note spells it', () => {
    // A note writes a link as a URL, so the space arrives encoded. The folder on
    // disk is named with the space.
    expect(imagePath('Read%20me/pic.png', '/Notes/Read me.md')).toBe('/Notes/Read me/pic.png')
    expect(imagePath('Read me/pic.png', '/Notes/Read me.md')).toBe('/Notes/Read me/pic.png')
  })

  test('is left alone when the encoding is not valid at all', () => {
    expect(imagePath('100%/pic.png', NOTE)).toBe('/Notes/Work/100%/pic.png')
  })

  test('is nothing for a picture the browser can already fetch', () => {
    expect(imagePath('https://example.com/pic.png', NOTE)).toBeNull()
    expect(imagePath('data:image/png;base64,AA', NOTE)).toBeNull()
  })

  test('is nothing for a note that has no home yet', () => {
    expect(imagePath('assets/pic.png', null)).toBeNull()
  })

  test('is re-based by typora-root-url, which is what makes a vault path work', () => {
    const source = '---\ntypora-root-url: /Notes\n---\n'
    expect(imagePath('/assets/pic.png', NOTE, source)).toBe('/Notes/assets/pic.png')
  })
})
