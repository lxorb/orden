import { providePort, webPages } from '@orden/contracts'
import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'

const FAVICON = 'data:image/png;base64,AA'

providePort('web.pages', {
  ...webPages(),
  faviconOf: (url) => (url === 'https://docs.dev/' ? FAVICON : null),
})

const { faceOf, FileMark, fileMark, initialOf, MARKS } = await import('../src/api')

describe('the marks', () => {
  test('name the mark a file wears by its name', () => {
    expect(fileMark('Plan.md')).toBe('note')
    expect(fileMark('Board.canvas')).toBe('canvas')
    expect(fileMark('Paper.pdf')).toBe('pdf')
    expect(fileMark('archive.zip')).toBe('file')
    expect(MARKS.note.length).toBeGreaterThan(0)
  })

  test('draw a plain note as its first letter until it chooses an icon', () => {
    expect(faceOf('note', false)).toBe('letter')
    expect(faceOf('note', true)).toBe('mark')
    expect(initialOf('  ünter')).toBe('Ü')
  })

  test('read a site’s picture through the web pages port', () => {
    const body = render(FileMark, { props: { mark: 'web', url: 'https://docs.dev/' } }).body
    expect(body).toContain(FAVICON)
  })
})
