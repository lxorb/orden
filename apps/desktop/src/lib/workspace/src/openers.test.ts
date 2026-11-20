import { describe, expect, test } from 'vitest'
import { type Opener, openerFor, sharedKind } from './openers'

const noNotes = (_path: string) => false
function opener(path: string, isUrlNote: (path: string) => boolean = noNotes): Opener | null {
  return openerFor(path, isUrlNote)
}
describe('what opens a path in the app', () => {
  test.each([
    ['Papers/Kestrel.pdf', 'pdf'],
    ['Links/Svelte docs.url', 'web'],
    ['Sketches/Wind.pages', 'pages'],
    ['Boards/Plan.canvas', 'canvas'],
    ['Terms/Build.term', 'term'],
    ['Terms/Build.TERM', 'term'],
    ['Read me.md', 'note'],
    ['notes/Kestrel.md', 'note'],
    ['data/table.csv', 'note'],
  ])('%s opens as %s', (path, kind) => {
    expect(opener(path)).toBe(kind)
  })
})
describe('a markdown note that is really a website', () => {
  const isSvelte = (path: string) => path === 'Links/Svelte.md'
  test('opens in the browser when the index says it holds a url', () => {
    expect(opener('Links/Svelte.md', isSvelte)).toBe('web')
  })
  test('opens as a note when the index has not caught up with it', () => {
    expect(opener('Links/Svelte.md', noNotes)).toBe('note')
  })
  test('and only a markdown note is asked about', () => {
    let asked = false
    opener('Links/Svelte docs.url', (path) => {
      asked = true
      return path.length > 0
    })
    expect(asked).toBe(false)
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
