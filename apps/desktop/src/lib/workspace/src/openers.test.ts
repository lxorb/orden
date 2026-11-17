import { describe, expect, test } from 'vitest'
import { type Build, type Opener, openerFor, sharedKind } from './openers'

const APP: Build = { evenBuild: false, isPlugin: false }

const PLUGIN: Build = { evenBuild: true, isPlugin: true }

const noNotes = (_path: string) => false

function opener(
  path: string,
  build = APP,
  isUrlNote: (path: string) => boolean = noNotes,
): Opener | null {
  return openerFor(path, isUrlNote, build)
}

describe('what opens a path in the app', () => {
  test('a PDF opens in the viewer', () => {
    expect(opener('Papers/Kestrel.pdf')).toBe('pdf')
  })

  test('a shortcut opens in the browser', () => {
    expect(opener('Links/Svelte docs.url')).toBe('web')
  })

  test('a page note opens on the handwriting surface', () => {
    expect(opener('Sketches/Wind.pages')).toBe('pages')
  })

  test('a canvas opens on the plane', () => {
    expect(opener('Boards/Plan.canvas')).toBe('canvas')
  })

  test('an online terminal opens as its terminal, not as the words that name it', () => {
    expect(opener('Terms/Build.term')).toBe('term')
    expect(opener('Terms/Build.TERM')).toBe('term')
  })

  test('and everything else opens as a note', () => {
    expect(opener('Read me.md')).toBe('note')
    expect(opener('notes/Kestrel.md')).toBe('note')
    expect(opener('data/table.csv')).toBe('note')
  })
})

describe('a markdown note that is really a website', () => {
  const isSvelte = (path: string) => path === 'Links/Svelte.md'

  test('opens in the browser when the index says it holds a url', () => {
    expect(opener('Links/Svelte.md', APP, isSvelte)).toBe('web')
  })

  test('opens as a note when the index has not caught up with it', () => {
    expect(opener('Links/Svelte.md', APP, noNotes)).toBe('note')
  })

  test('and only a markdown note is asked about', () => {
    let asked = false
    opener('Links/Svelte docs.url', APP, (path) => {
      asked = true
      return path.length > 0
    })
    expect(asked).toBe(false)
  })
})

describe('in front of a pair of glasses', () => {
  test('a PDF, a canvas and a page note open nothing', () => {
    expect(opener('Papers/Kestrel.pdf', PLUGIN)).toBeNull()
    expect(opener('Boards/Plan.canvas', PLUGIN)).toBeNull()
    expect(opener('Sketches/Wind.pages', PLUGIN)).toBeNull()
  })

  test('an online terminal opens nothing, having no terminal to open in', () => {
    expect(opener('Terms/Build.term', PLUGIN)).toBeNull()
  })

  test('a note still opens', () => {
    expect(opener('Read me.md', PLUGIN)).toBe('note')
  })

  test('and a shortcut is not stopped here - openWeb declines it itself', () => {
    expect(opener('Links/Svelte docs.url', PLUGIN)).toBe('web')
  })

  test('and the PDF asks the build while the others ask the latch', () => {
    expect(opener('Papers/Kestrel.pdf', { evenBuild: false, isPlugin: true })).toBe('pdf')
    expect(opener('Boards/Plan.canvas', { evenBuild: false, isPlugin: true })).toBeNull()
  })
})

describe('a file somebody shared on its own', () => {
  test('opens in the tab its name on the account asks for (#386)', () => {
    expect(sharedKind('/Boards/board.canvas')).toBe('canvas')
    expect(sharedKind('/Notes/slides.pages')).toBe('pages')
    expect(sharedKind('/Team/planning.chat')).toBe('channel')
    expect(sharedKind('/Notes/plan.md')).toBe('note')
  })
})
