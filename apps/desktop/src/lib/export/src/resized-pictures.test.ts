import { describe, expect, test } from 'vitest'
import { documentOf, picturesIn } from './document'
import { bundleFiles } from './textbundle'

const RESIZED = 'Before\n\n<img src="pic.png" alt="A dog" style="zoom:50%;" />\n\nAfter\n'
const RESIZED_INLINE = 'See <img src="pic.png" alt="A dog" style="zoom:50%;" /> here.\n'

const PICTURE = { src: 'pic.png', name: 'pic.png', mime: 'image/png', bytes: new Uint8Array([1]) }

describe('a picture resized in Live Preview, which writes it as an <img> tag', () => {
  test('is still a picture of the note for Word and RTF exports', () => {
    expect(picturesIn(documentOf(RESIZED, 'Note'))).toEqual(['pic.png'])
  })

  test('is still a picture of the note when resized inside a line', () => {
    expect(picturesIn(documentOf(RESIZED_INLINE, 'Note'))).toEqual(['pic.png'])
  })

  test('points at the copy in the assets folder of a TextBundle', () => {
    const text = bundleFiles(RESIZED, [PICTURE]).find((file) => file.path === 'text.md')?.body
    expect(text).toContain('assets/pic.png')
  })
})

test('a resized picture with & in its name points at its copy in a TextBundle', () => {
  const source = '<img src="R&amp;D.png" alt="" style="zoom:50%;" />\n'
  const picture = { ...PICTURE, src: 'R&D.png', name: 'R&D.png' }
  const text = bundleFiles(source, [picture]).find((file) => file.path === 'text.md')?.body
  expect(text).toContain('src="assets/R&amp;D.png"')
})
