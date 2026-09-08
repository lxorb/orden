import { describe, expect, test } from 'vitest'
import { extensionOf, mimeOf } from './copy'

describe('the extension a copy keeps', () => {
  test('is the one the file already has, lowercased', () => {
    expect(extensionOf('/space/Paper.PDF')).toBe('pdf')
    expect(extensionOf('C:\\Notes\\shot.png')).toBe('png')
  })

  test('is bin for a file with no extension at all', () => {
    expect(extensionOf('/space/README')).toBe('bin')
  })

  /** A folder called `my.notes` does not make every file inside it a `.notes`. */
  test('never reads a dot in a folder name as one', () => {
    expect(extensionOf('/my.notes/paper')).toBe('bin')
    expect(extensionOf('/my.notes/paper.pdf')).toBe('pdf')
  })
})

describe('what a copy says it is', () => {
  test('names the papers and pictures a browser can open', () => {
    expect(mimeOf('/s/a.pdf')).toBe('application/pdf')
    expect(mimeOf('/s/a.jpeg')).toBe('image/jpeg')
    expect(mimeOf('/s/a.jpg')).toBe('image/jpeg')
    expect(mimeOf('/s/a.png')).toBe('image/png')
  })

  test('claims nothing about a file it does not know', () => {
    expect(mimeOf('/s/a.xyz')).toBe('application/octet-stream')
  })
})
