import { describe, expect, test } from 'vitest'
import { fromOf, siteOf, spot, whereOf } from './card'

describe("the card's place", () => {
  const anchor = { left: 100, right: 300, bottom: 38 }

  test('is under the tab, from its leading edge', () => {
    expect(spot(anchor, 256, 1200, 1)).toEqual({ x: 100, y: 42 })
  })

  test('from its trailing edge in a language that reads the other way', () => {
    expect(spot(anchor, 256, 1200, -1)).toEqual({ x: 44, y: 42 })
  })

  test('and inside the window', () => {
    expect(spot({ left: 1100, right: 1190, bottom: 38 }, 256, 1200, 1).x).toBe(936)
    expect(spot({ left: 2, right: 60, bottom: 38 }, 256, 1200, -1).x).toBe(8)
  })
})

describe('what the card says a page is on', () => {
  test('is the host, without the www nobody reads', () => {
    expect(siteOf('https://www.example.com/a/b?c')).toBe('example.com')
    expect(siteOf('http://news.ycombinator.com/')).toBe('news.ycombinator.com')
  })

  test('and nothing for what is not a site', () => {
    expect(siteOf(null)).toBe('')
    expect(siteOf('about:blank')).toBe('')
    expect(siteOf('not an address')).toBe('')
  })
})

describe('where the card says a file lives', () => {
  const spaces = [
    { name: 'Work', root: 'C:\\Spaces\\Work' },
    { name: 'Home', root: '/home/me/Spaces/Home' },
  ]

  test('is its space and the folders down to it', () => {
    expect(whereOf('C:\\Spaces\\Work\\Projects\\2026\\Plan.md', spaces)).toBe(
      'Work / Projects / 2026',
    )
    expect(whereOf('/home/me/Spaces/Home/List.md', spaces)).toBe('Home')
  })

  test('and nothing for a file in no space', () => {
    expect(whereOf('D:\\Downloads\\x.md', spaces)).toBe('')
    expect(whereOf(null, spaces)).toBe('')
  })
})

/** Emil, 2026-10-03: a web tab's card says which space it is from. */
describe('the space a web tab is from', () => {
  const spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
  ]

  test('is its file’s for a page kept as a web note', () => {
    expect(fromOf('/spaces/Home/Recipes/Soup.url', null, spaces, 'work')).toEqual({
      id: 'home',
      name: 'Home',
    })
  })

  test('is the one it was opened in for a page nobody kept', () => {
    expect(fromOf(null, 'home', spaces, 'work')).toEqual({ id: 'home', name: 'Home' })
  })

  test('is said only where it is not the space on screen', () => {
    expect(fromOf('/spaces/Work/Docs.url', null, spaces, 'work')).toBeNull()
    expect(fromOf(null, 'work', spaces, 'work')).toBeNull()
  })

  test('is nothing for a page that is no space’s', () => {
    expect(fromOf(null, null, spaces, 'work')).toBeNull()
    expect(fromOf('/elsewhere/Page.url', null, spaces, 'work')).toBeNull()
    expect(fromOf(null, 'gone', spaces, 'work')).toBeNull()
  })
})
