import { describe, expect, test } from 'vitest'
import { imagePath } from './images'

const NOTE = '/Notes/Work/Plan.md'

describe('where a picture a note points at lives', () => {
  test("is the space's own folder when the note climbs to it", () => {
    expect(imagePath('../assets/pic.png', NOTE)).toBe('/Notes/assets/pic.png')
    expect(imagePath('../../assets/pic.png', '/Notes/Work/2026/Q1.md')).toBe('/Notes/assets/pic.png')
  })

  test('is nothing for a picture the browser can already fetch', () => {
    expect(imagePath('https://example.com/pic.png', NOTE)).toBeNull()
    expect(imagePath('data:image/png;base64,AA', NOTE)).toBeNull()
  })

  test('is nothing for a note that has no home yet', () => {
    expect(imagePath('assets/pic.png', null)).toBeNull()
  })

  test('is from the top of the space when the path starts with a slash', () => {
    expect(imagePath('/assets/pic.png', NOTE, '', '/Notes')).toBe('/Notes/assets/pic.png')
    const source = '---\ntypora-root-url: /Notes/Work\n---\n'
    expect(imagePath('/assets/pic.png', NOTE, source, '/Notes')).toBe('/Notes/Work/assets/pic.png')
  })

  test('is re-based by typora-root-url, which is what makes a vault path work', () => {
    const source = '---\ntypora-root-url: /Notes\n---\n'
    expect(imagePath('/assets/pic.png', NOTE, source)).toBe('/Notes/assets/pic.png')
  })
})

test.each<[unknown, ...Parameters<typeof imagePath>]>([
  ['/Notes/Work/assets/pic.png', 'assets/pic.png', NOTE],
  ['/Notes/Read me/pic.png', 'Read%20me/pic.png', '/Notes/Read me.md'],
  ['/Notes/Read me/pic.png', 'Read me/pic.png', '/Notes/Read me.md'],
  ['/Notes/Work/100%/pic.png', '100%/pic.png', NOTE],
])('%j from %j', (expected, ...args) => {
  expect(imagePath(...args)).toBe(expected)
})
