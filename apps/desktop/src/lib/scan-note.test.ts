import { describe, expect, test } from 'vitest'
import { scanCanvas, scanNote } from './scan-note'

describe('reading a note for the index', () => {
  test('finds its headings, its blocks and its links', () => {
    const note = scanNote(
      'ideas/Plan.md',
      '# Plan\n\nSee [[Other]] and [x](../notes/Third.md). ^abc123\n\n## Later\n',
    )

    expect(note.name).toBe('Plan')
    expect(note.headings).toEqual(['Plan', 'Later'])
    expect(note.blocks).toEqual(['abc123'])
    expect(note.links.map((link) => link.target)).toEqual(['Other', '../notes/Third.md'])
  })
})

describe('reading a canvas for the index', () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '# not a link' },
      { id: 'b', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'ideas/Plan.md' },
      {
        id: 'c',
        type: 'file',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        file: 'Notes.md',
        subpath: '#Later',
      },
      { id: 'd', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'x.md', subpath: '#^abc123' },
      { id: 'e', type: 'link', x: 0, y: 0, width: 1, height: 1, url: 'https://example.com' },
    ],
    edges: [],
  })

  test('keeps its whole name, the way a link has to write it', () => {
    expect(scanCanvas('boards/Board.canvas', canvas).name).toBe('Board.canvas')
  })

  test('reads each file node as one link out of it', () => {
    const links = scanCanvas('Board.canvas', canvas).links

    expect(links.map((link) => link.target)).toEqual(['ideas/Plan.md', 'Notes.md', 'x.md'])
    expect(links.every((link) => link.kind === 'wikilink')).toBe(true)
  })

  test('reads a subpath as the heading or the block it names', () => {
    const links = scanCanvas('Board.canvas', canvas).links

    expect(links[0]).toMatchObject({ heading: null, block: null })
    expect(links[1]).toMatchObject({ heading: 'Later', block: null })
    expect(links[2]).toMatchObject({ heading: null, block: 'abc123' })
  })

  /** Nothing points into a canvas, only at it, so there is nothing to point at
   *  inside one. */
  test('has no headings and no blocks of its own', () => {
    const read = scanCanvas('Board.canvas', canvas)

    expect(read.headings).toEqual([])
    expect(read.blocks).toEqual([])
  })

  test('is an empty reading of a file that is not a canvas at all', () => {
    const read = scanCanvas('Board.canvas', 'not json')

    expect(read.links).toEqual([])
    expect(read.path).toBe('Board.canvas')
  })
})
