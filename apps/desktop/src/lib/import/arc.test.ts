import { describe, expect, test } from 'vitest'

import { arcSidebar } from './arc'
import { SIDEBAR } from './arc.fixture'
import { sidebarImport } from './sidebar-plan'

const NOW = new Date('2026-11-05T08:00:00.000Z')

function planned(folder = 'Default') {
  const read = arcSidebar(SIDEBAR, folder)
  if (!read) throw new Error('no sidebar read')
  return sidebarImport(read.sidebar, NOW, null).spaces
}

describe("Arc's sidebar as Orden's", () => {
  test("is a space for each of the profile's spaces, with its emoji", () => {
    expect(planned().map((one) => [one.name, one.icon])).toEqual([
      ['Personal', '🏠'],
      ['Work', '💼'],
    ])
    expect(planned('Profile 1').map((one) => one.name)).toEqual(['Side project'])
  })

  test("makes the profile's Favorites the Essentials of its first space, in their order", () => {
    const [personal, work] = planned()
    expect(personal?.bookmarks).toEqual(['Inbox.url', 'Calendar.url'])
    expect(work?.bookmarks).toEqual([])
    expect(planned('Profile 1')[0]?.bookmarks).toEqual(['Other.url'])
  })

  test('puts the pinned tabs and folders first, a split view in its folder, then the open tabs', () => {
    const [personal, work] = planned()
    expect(personal?.order['']).toEqual([
      'Inbox.url',
      'Calendar.url',
      'Docs',
      'News.url',
      'arc - Search.url',
    ])
    expect(personal?.order.Docs).toEqual(['Left.url', 'Right.url', 'The guide.url'])
    expect(work?.order['']).toEqual(['Board.url'])
  })

  test('counts the easels and notes that stay', () => {
    expect(arcSidebar(SIDEBAR, 'Default')?.stayed).toBe(1)
  })

  test('is nothing for a file with no spaces of the profile', () => {
    expect(arcSidebar(SIDEBAR, 'Profile 9')).toBeNull()
    expect(arcSidebar({ sidebar: { containers: [] } }, 'Default')).toBeNull()
    expect(arcSidebar('nonsense', 'Default')).toBeNull()
  })
})
