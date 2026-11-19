import { afterEach, describe, expect, test } from 'vitest'
import { providePort } from '@orden/contracts'
import { bookmarkAll, iconEntries, rowMenus, shareEntry, webDataEntry } from '../src/api'

const gone: (() => void)[] = []
afterEach(() => {
  for (const one of gone.splice(0)) one()
})
describe('the row menus', () => {
  test('open behind their door', async () => {
    const menus = await rowMenus()
    expect(typeof menus.rowMenu).toBe('function')
    expect(typeof menus.newFileRows).toBe('function')
  })
  test('offer nothing for no path', () => {
    expect(bookmarkAll([])).toEqual([])
    expect(iconEntries(null)).toEqual([])
    expect(shareEntry(undefined)).toEqual([])
    expect(webDataEntry({ path: '/s/a.md', is_dir: false })).toEqual([])
  })
  test('ask the chats before a chat is deleted, and keep it when they refuse', async () => {
    const asked: string[][] = []
    gone.push(
      providePort('chats', {
        list: () => Promise.resolve([]),
        chatAt: () => Promise.resolve(null),
        part: () => Promise.resolve(null),
        offer: () => Promise.resolve(),
        openLink: () => Promise.resolve(),
        mayDelete: (paths) => {
          asked.push([...paths])
          return Promise.resolve(false)
        },
      }),
    )
    const { removeAsking } = await rowMenus()
    await removeAsking(['/s/a.md'])
    await removeAsking(['/s/Team.chat'])
    expect(asked).toEqual([['/s/Team.chat']])
  })
})
