import { describe, expect, test } from 'vitest'

import { readShortcut } from '../web-tab/shortcut'
import { safariSidebar } from './safari'
import { BOOKMARKS, SESSION, TABS } from './safari.fixture'
import type { FolderWords } from './sidebar-made'
import { sidebarImport } from './sidebar-plan'

const WORDS: FolderWords = {
  bookmarks: 'Bookmarks',
  savedGroups: 'Saved groups',
  group: 'Tab group',
  toolbar: 'Bookmarks toolbar',
  bar: 'Bookmarks bar',
  menu: 'Bookmarks menu',
  other: 'Other bookmarks',
  mobile: 'Mobile bookmarks',
  favorites: 'Favorites',
  readingList: 'Reading List',
}

const NOW = new Date('2026-10-18T08:00:00.000Z')

function space(files: Partial<{ bookmarks: unknown; tabs: unknown; session: unknown }>) {
  const sidebar = safariSidebar(
    { bookmarks: null, tabs: null, session: null, ...files },
    'Safari',
    WORDS,
  )
  return { sidebar, space: sidebarImport(sidebar, NOW, null).spaces[0] }
}

describe("Safari's tabs, bookmarks and Reading List as nib's", () => {
  test('puts the pinned tab first as an Essential, a tab group as a folder, the window’s own tabs at the top', () => {
    const { space: safari } = space({ tabs: TABS, bookmarks: BOOKMARKS })
    expect(safari?.order['']).toEqual([
      'Mail.url',
      'Cars',
      'Board.url',
      'Bookmarks',
      'Reading List',
    ])
    expect(safari?.bookmarks).toEqual(['Mail.url'])
    expect(safari?.order.Cars).toEqual(['One.url', 'Two.url'])
  })

  test('leaves a deleted tab, a blank one and Safari’s own lists, and counts the page not on the web', () => {
    const { sidebar, space: safari } = space({ tabs: TABS })
    const paths = safari?.files.map((one) => one.path) ?? []
    expect(paths.some((path) => /Gone|Elsewhere|Settings/.test(path))).toBe(false)
    expect(sidebar.dropped).toBe(1)
  })

  test('makes Favorites, the menu and the other lists the Bookmarks folder, History left', () => {
    const { space: safari } = space({ bookmarks: BOOKMARKS })
    expect(safari?.order.Bookmarks).toEqual(['Favorites', 'Bookmarks menu', 'Trips'])
    expect(safari?.order['Bookmarks/Favorites']).toEqual(['Work', 'News.url'])
    expect(safari?.order['Bookmarks/Favorites/Work']).toEqual(['Wiki.url'])
  })

  test('makes the Reading List a folder of its own, each page kept on the day it was added', () => {
    const { space: safari } = space({ bookmarks: BOOKMARKS })
    const file = safari?.files.find((one) => one.path === 'Reading List/A long read.url')
    const read = file?.kind === 'note' ? readShortcut(file.text) : null
    expect(read).toMatchObject({
      url: 'https://long.example.com/read',
      added: '2026-10-01T08:00:00.000Z',
    })
  })

  test('reads an older Safari’s windows where there is no tab database, never a private one', () => {
    const { space: safari } = space({ session: SESSION })
    expect(safari?.order['']).toEqual(['Mail.url', 'News.url'])
    expect(safari?.bookmarks).toEqual(['Mail.url'])
    // The tab database wins where both are there.
    expect(space({ tabs: TABS, session: SESSION }).space?.order['']).not.toContain('News.url')
  })

  test('reads nothing out of nothing', () => {
    expect(space({ bookmarks: 'nonsense', tabs: 7 }).space?.files).toEqual([])
  })
})
