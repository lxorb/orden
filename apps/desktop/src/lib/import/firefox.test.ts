import { describe, expect, test } from 'vitest'

import { readShortcut } from '../web-tab/shortcut'
import { firefoxSidebar } from './firefox'
import type { FolderWords } from './sidebar-made'
import { BOOKMARKS, page, SESSION } from './firefox.fixture'
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
const CONTAINERS = { text: 'Containers stay in Firefox' }

function planned(session: unknown = SESSION, bookmarks: unknown = BOOKMARKS) {
  return sidebarImport(firefoxSidebar(session, bookmarks, 'Firefox', WORDS), NOW, CONTAINERS)
}

describe("Firefox's tabs and bookmarks as nib's", () => {
  test('is one space, named as asked', () => {
    expect(planned().spaces.map((one) => one.name)).toEqual(['Firefox'])
  })

  test('puts the pinned tab first as an Essential, then the tabs and groups in order', () => {
    const [space] = planned().spaces
    expect(space?.order['']).toEqual([
      'Mail.url',
      'News today.url',
      'Docs',
      'Bank.url',
      'Tab group',
      'Saved groups',
      'Bookmarks',
    ])
    expect(space?.bookmarks).toEqual(['Mail.url'])
    expect(space?.order.Docs).toEqual(['The guide.url', 'API reference.url'])
    expect(space?.order['Tab group']).toEqual(['Later.url'])
  })

  test('keeps a saved group in Saved groups', () => {
    const [space] = planned().spaces
    expect(space?.order['Saved groups']).toEqual(['Trip'])
    expect(space?.order['Saved groups/Trip']).toEqual(['Flights.url', 'Hotel.url'])
  })

  test('reads a group open and saved at once as the open one alone', () => {
    // Firefox saves a window's open groups as it quits, and both are in the file.
    const session = {
      ...SESSION,
      savedGroups: [
        ...SESSION.savedGroups,
        {
          id: 'g1',
          name: 'Docs',
          saveOnWindowClose: true,
          tabs: [{ state: page('https://docs.example.com/guide', 'The guide') }],
        },
      ],
    }
    const [space] = planned(session).spaces
    expect(space?.order['Saved groups']).toEqual(['Trip'])
    expect(space?.files.filter((one) => one.path.endsWith('The guide.url'))).toHaveLength(1)
  })

  test('makes the bookmarks a folder of roots, leaving the tags, the empty and the unpointable', () => {
    const [space] = planned().spaces
    expect(space?.order.Bookmarks).toEqual(['Bookmarks toolbar', 'Bookmarks menu'])
    expect(space?.order['Bookmarks/Bookmarks toolbar']).toEqual(['Work', 'News.url'])
    expect(space?.order['Bookmarks/Bookmarks toolbar/Work']).toEqual(['Board.url'])
    expect(space?.order['Bookmarks/Bookmarks menu']).toEqual(['Recipes.url'])
    const paths = space?.files.map((one) => one.path) ?? []
    expect(paths.some((path) => path.includes('Nothing') || path.includes('bookmarklet'))).toBe(
      false,
    )
    expect(paths.some((path) => path.includes('Settings') || path.includes('Secret'))).toBe(false)
  })

  test('reads a backup an older Firefox wrote, which names each kind rather than numbering it', () => {
    const older = {
      guid: 'root________',
      type: 'text/x-moz-place-container',
      children: [
        {
          guid: 'menu________',
          title: 'Bookmarks Menu',
          type: 'text/x-moz-place-container',
          children: [
            {
              guid: 'f1',
              title: 'Mozilla Firefox',
              type: 'text/x-moz-place-container',
              children: [
                {
                  guid: 'b1',
                  title: 'Help and Tutorials',
                  type: 'text/x-moz-place',
                  uri: 'http://www.mozilla.com/en-US/firefox/help/',
                },
              ],
            },
            { guid: 's1', type: 'text/x-moz-place-separator' },
          ],
        },
        // Roots known by the name of the root they are, with no id of their own.
        {
          title: 'Bookmarks Toolbar',
          root: 'toolbarFolder',
          type: 'text/x-moz-place-container',
          children: [
            { title: 'Getting Started', type: 'text/x-moz-place', uri: 'http://start.example/' },
          ],
        },
        {
          title: 'Tags',
          root: 'tagsFolder',
          type: 'text/x-moz-place-container',
          children: [
            {
              title: 'tagged',
              type: 'text/x-moz-place-container',
              children: [{ type: 'text/x-moz-place', uri: 'http://start.example/' }],
            },
          ],
        },
      ],
    }
    const [space] = planned(null, older).spaces
    expect(space?.order.Bookmarks).toEqual(['Bookmarks toolbar', 'Bookmarks menu'])
    expect(space?.order['Bookmarks/Bookmarks menu/Mozilla Firefox']).toEqual([
      'Help and Tutorials.url',
    ])
    expect(space?.order['Bookmarks/Bookmarks toolbar']).toEqual(['Getting Started.url'])
  })

  test('writes a bookmark as kept on the day it was bookmarked, a tab on the day of the import', () => {
    const [space] = planned().spaces
    const read = (path: string) => {
      const file = space?.files.find((one) => one.path === path)
      return file?.kind === 'note' ? readShortcut(file.text) : null
    }
    expect(read('Bookmarks/Bookmarks menu/Recipes.url')).toMatchObject({
      url: 'https://recipes.example.com/',
      added: '2023-11-14T22:13:20.000Z',
    })
    expect(read('News today.url')).toMatchObject({
      url: 'https://news.example.com/today',
      added: NOW.toISOString(),
    })
  })

  test('counts the pages it left behind for not being on the web', () => {
    expect(firefoxSidebar(SESSION, BOOKMARKS, 'Firefox', WORDS).dropped).toBe(2)
    expect(firefoxSidebar(null, null, 'Firefox', WORDS).dropped).toBe(0)
  })

  test('says containers stay where a tab was in one', () => {
    expect(planned().lost).toEqual([CONTAINERS])
    expect(planned(null).lost).toEqual([])
  })

  test('reads a session alone, bookmarks alone, and neither', () => {
    expect(planned(SESSION, null).spaces[0]?.order['']).not.toContain('Bookmarks')
    expect(planned(null, BOOKMARKS).spaces[0]?.order['']).toEqual(['Bookmarks'])
    expect(planned('nonsense', 7).spaces[0]?.files).toEqual([])
  })
})
