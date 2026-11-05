import { describe, expect, test } from 'vitest'

import { readShortcut } from '@orden/scan/shortcut'
import type { FolderWords } from './sidebar-made'
import { readZenSession, withBookmarks, type ZenPlaces } from './zen'
import { zenImport } from './zen-plan'
import { ZEN_1_17, ZEN_1_17_PLACES, ZEN_1_24, ZEN_TWILIGHT } from './zen-versions.fixture'

const NOW = new Date('2026-11-05T08:00:00.000Z')

const VERSIONS: [string, unknown, ZenPlaces | null][] = [
  ['1.24', ZEN_1_24, null],
  ['a twilight 1.18', ZEN_TWILIGHT, null],
  ['1.17', ZEN_1_17, ZEN_1_17_PLACES],
]

function planned(said: unknown, places: ZenPlaces | null) {
  const session = readZenSession(said, places)
  if (!session) throw new Error('no sidebar read')
  return zenImport(session, NOW).spaces
}

describe.each(VERSIONS)("Zen %s's Essentials", (_, said, places) => {
  test('are read, in their order, as the Essentials they are', () => {
    const tabs = readZenSession(said, places)?.tabs ?? []
    expect(tabs.filter((one) => one.essential).map((one) => one.title)).toEqual([
      'Mail',
      'Calendar',
      'Chat',
    ])
    expect(tabs.filter((one) => one.essential).every((one) => one.space === null)).toBe(true)
  })

  test('are the Essentials of the first space, at its top, one made in Work among them', () => {
    const [home, work] = planned(said, places)
    expect(home?.name).toBe('Home')
    expect(home?.bookmarks).toEqual(['Mail.url', 'Calendar.url', 'Chat.url'])
    expect(home?.order['']?.slice(0, 4)).toEqual([
      'Mail.url',
      'Calendar.url',
      'Chat.url',
      'News.url',
    ])
    expect(work?.bookmarks).toEqual([])
    const mail = home?.files.find((one) => one.path === 'Mail.url')
    expect(mail?.kind === 'note' && readShortcut(mail.text)?.url).toBe('https://example.com/mail')
  })

  test('leave the pinned tabs and the folders where Zen has them', () => {
    const [, work] = planned(said, places)
    expect(work?.icon).toBe('briefcase')
    expect(work?.order['']).toEqual(['Docs', 'Board.url', 'b - Search.url'])
    expect(work?.order.Docs).toHaveLength(2)
    expect(work?.files.map((one) => one.path)).not.toContain('Docs.md')
  })
})

describe('a Zen up to 1.17', () => {
  test('is read only with the spaces and the pins Places keeps', () => {
    expect(readZenSession(ZEN_1_17)).toBeNull()
  })

  test('takes its spaces in their order and the pinned tab the session lost', () => {
    const [home, work] = planned(ZEN_1_17, ZEN_1_17_PLACES)
    expect([home?.name, work?.name]).toEqual(['Home', 'Work'])
    expect(home?.order['']).toEqual(['Mail.url', 'Calendar.url', 'Chat.url', 'News.url'])
  })

  test('takes the name somebody gave a pin, and the page of a pin that had not loaded', () => {
    const [, work] = planned(ZEN_1_17, ZEN_1_17_PLACES)
    expect(work?.order.Docs).toEqual(['The guide.url', 'API.url'])
    const board = work?.files.find((one) => one.path === 'Board.url')
    expect(board?.kind === 'note' && readShortcut(board.text)?.url).toBe(
      'https://example.net/board',
    )
  })
})

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

/** Zen's bookmarks as places.sqlite holds them: a folder on the toolbar shown in Work
 *  alone, and a bookmark shown everywhere. */
const PLACES: ZenPlaces = {
  spaces: [],
  pins: [],
  assigned: [
    { bookmark_guid: 'reading', workspace_uuid: '{90bb2d5f-4e6e-4d01-80cf-84d545dda229}' },
    { bookmark_guid: 'reading', workspace_uuid: '{gone}' },
  ],
  bookmarks: {
    guid: 'root________',
    typeCode: 2,
    children: [
      {
        guid: 'toolbar_____',
        typeCode: 2,
        children: [
          {
            guid: 'reading',
            title: 'Reading',
            typeCode: 2,
            children: [{ guid: 'a', title: 'Article', typeCode: 1, uri: 'https://example.com/a' }],
          },
          { guid: 'w', title: 'Wiki', typeCode: 1, uri: 'https://example.org/wiki' },
          { guid: 'js', title: 'Tool', typeCode: 1, uri: 'javascript:void(0)' },
        ],
      },
    ],
  },
}

describe("Zen's bookmarks", () => {
  test('come in the first space, and a folder Zen shows only in a space in that one', () => {
    const session = readZenSession(ZEN_1_24)
    if (!session) throw new Error('no sidebar read')
    const marked = withBookmarks(session, PLACES, WORDS)
    const [home, work] = zenImport(marked, NOW).spaces

    expect(home?.order['']?.at(-1)).toBe('Bookmarks')
    expect(home?.order['Bookmarks/Bookmarks toolbar']).toEqual(['Wiki.url'])
    expect(work?.order['Bookmarks/Bookmarks toolbar']).toEqual(['Reading'])
    expect(work?.order['Bookmarks/Bookmarks toolbar/Reading']).toEqual(['Article.url'])
    expect(marked.dropped).toBe(1)
  })

  test('are nothing where Places could not be read', () => {
    const session = readZenSession(ZEN_1_24)
    if (!session) throw new Error('no sidebar read')
    expect(withBookmarks(session, null, WORDS)).toBe(session)
  })
})
