import { describe, expect, test } from 'vitest'
import { mapSources, sourcesOf } from './sources'

describe('the addresses a page names', () => {
  test('every element that points at a file, once, in order', () => {
    const html =
      '<img src="a.png"><audio src="b.mp3"></audio><video src="c.mp4"></video><img src="a.png">'
    expect(sourcesOf(html)).toEqual(['a.png', 'b.mp3', 'c.mp4'])
  })

  test('a source inside a video as well, which is how one names two codecs', () => {
    expect(sourcesOf('<video><source src="a.webm"><source src="a.mp4"></video>')).toEqual([
      'a.webm',
      'a.mp4',
    ])
  })

  test('and never a frame, whose address is a page somewhere else', () => {
    expect(sourcesOf('<iframe src="https://x.test/embed"></iframe>')).toEqual([])
  })

  test('only the ones the caller wants', () => {
    const html = '<img src="a.png"><img src="data:image/png;base64,AA">'
    expect(sourcesOf(html, (src) => !src.startsWith('data:'))).toEqual(['a.png'])
  })

  test('nothing at all in a page that names none', () => {
    expect(sourcesOf('<p>words <a href="a.png">link</a></p>')).toEqual([])
  })
})

describe('pointing them somewhere else', () => {
  test('each address the caller answers for', () => {
    const html = '<img src="a.png" alt="x"><audio controls src="b.mp3"></audio>'
    expect(mapSources(html, (src) => `asset://${src}`)).toBe(
      '<img src="asset://a.png" alt="x"><audio controls src="asset://b.mp3"></audio>',
    )
  })

  test('and leaves the rest exactly as they were', () => {
    const html = '<img src="a.png"><img src="b.png">'
    expect(mapSources(html, (src) => (src === 'a.png' ? 'c.png' : null))).toBe(
      '<img src="c.png"><img src="b.png">',
    )
  })

  test('an attribute before the source is kept', () => {
    expect(mapSources('<img class="wide" src="a.png" width="30">', () => 'b.png')).toBe(
      '<img class="wide" src="b.png" width="30">',
    )
  })

  test('a frame is left alone', () => {
    const html = '<iframe src="https://x.test/e"></iframe>'
    expect(mapSources(html, () => 'gone')).toBe(html)
  })
})
