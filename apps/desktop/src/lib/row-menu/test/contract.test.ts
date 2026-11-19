import { afterEach, describe, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'
import { bookmarkAll, iconEntries, rowMenus, shareEntry, webDataEntry } from '../src/api'

vi.mock('../../gates/src/api', async (actual) => {
  const real = await actual<{ hiddenKinds: object }>()
  Object.defineProperty(real.hiddenKinds, 'shown', { get: () => ['note', 'chat'], configurable: true })
  return { ...real, basesOn: () => true }
})
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
  test('never offer to make a chat, even where chats are on', async () => {
    const { newFileRows } = await rowMenus()
    expect(newFileRows().map((one) => one?.label)).toEqual(['New note'])
    expect(newFileRows('/s/Projects').map((one) => one?.label)).toEqual(['New note'])
  })
  test('never offer to make a database, even where databases are on', async () => {
    const { newFileRows } = await rowMenus()
    const labels = [...newFileRows(), ...newFileRows('/s/Projects')].map((one) => one?.label)
    expect(labels).not.toContain('New database')
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
