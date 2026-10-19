import { describe, expect, test } from 'vitest'

import { fromBase64 } from '../bytes'
import { readShortcut } from '../web-tab/shortcut'
import { chromiumSidebar } from './chromium'
import { BOOKMARKS, SESSION } from './chromium.fixture'
import type { FolderWords } from './sidebar-made'
import { sidebarImport } from './sidebar-plan'
import { readSnss } from './snss'

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

function session() {
  const read = readSnss(fromBase64(SESSION))
  if (read === null || read === 'locked') throw new Error('the fixture is a session')
  return read
}

function space(
  bookmarks: unknown = BOOKMARKS,
  tabs: ReturnType<typeof session> | null = session(),
) {
  const sidebar = chromiumSidebar(tabs, bookmarks, 'Chrome', WORDS)
  return sidebarImport(sidebar, NOW, { text: 'none' }).spaces[0]
}

describe("Chrome's tabs and bookmarks as nib's", () => {
  test('puts the pinned tab first as an Essential, then the tabs and groups in order', () => {
    const chrome = space()
    expect(chrome?.name).toBe('Chrome')
    expect(chrome?.order['']).toEqual([
      'mail.example.com.url',
      'news.example.com today.url',
      'Docs',
      'Tab group',
      'Bookmarks',
    ])
    expect(chrome?.bookmarks).toEqual(['mail.example.com.url'])
    expect(chrome?.order.Docs).toEqual(['docs.example.com guide.url', 'docs.example.com api.url'])
    expect(chrome?.order['Tab group']).toEqual(['later.example.com.url'])
  })

  test('makes the bookmarks a folder of roots, leaving the empty and the unpointable', () => {
    const chrome = space()
    expect(chrome?.order.Bookmarks).toEqual(['Bookmarks bar', 'Other bookmarks'])
    expect(chrome?.order['Bookmarks/Bookmarks bar']).toEqual(['Work', 'News.url'])
    expect(chrome?.order['Bookmarks/Bookmarks bar/Work']).toEqual(['Board.url'])
    expect(chrome?.order['Bookmarks/Other bookmarks']).toEqual(['Recipes.url'])
  })

  test('keeps a bookmark on the day Chromium says it was made', () => {
    const file = space()?.files.find((one) => one.path === 'Bookmarks/Other bookmarks/Recipes.url')
    const read = file?.kind === 'note' ? readShortcut(file.text) : null
    expect(read?.url).toBe('https://recipes.example.com/')
    expect(read?.added?.startsWith('2026-10-18T')).toBe(true)
  })

  test("puts a signed-in profile's account bookmarks in the same roots, first", () => {
    const account = {
      roots: {
        bookmark_bar: {
          children: [
            {
              type: 'folder',
              guid: 'a-work',
              name: 'Work',
              children: [{ type: 'url', url: 'https://wiki.example.com/', name: 'Wiki' }],
            },
          ],
        },
        other: { children: [] },
        synced: { children: [{ type: 'url', url: 'https://phone.example.com/', name: 'Phone' }] },
      },
    }
    const sidebar = chromiumSidebar(null, BOOKMARKS, 'Chrome', WORDS, account)
    const chrome = sidebarImport(sidebar, NOW, { text: 'none' }).spaces[0]
    expect(chrome?.order.Bookmarks).toEqual([
      'Bookmarks bar',
      'Other bookmarks',
      'Mobile bookmarks',
    ])
    expect(chrome?.order['Bookmarks/Bookmarks bar']).toEqual(['Work', 'Work 2', 'News.url'])
    expect(chrome?.order['Bookmarks/Bookmarks bar/Work']).toEqual(['Wiki.url'])
    expect(chrome?.order['Bookmarks/Bookmarks bar/Work 2']).toEqual(['Board.url'])
    expect(chrome?.order['Bookmarks/Mobile bookmarks']).toEqual(['Phone.url'])
  })

  test('reads the bookmarks alone where the session could not be', () => {
    expect(space(BOOKMARKS, null)?.order['']).toEqual(['Bookmarks'])
    expect(space(null, null)?.files).toEqual([])
  })
})
