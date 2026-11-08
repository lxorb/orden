import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Listing } from './commands'

const DISK: Record<string, { name: string; hidden?: boolean }[]> = {
  '/home/me/Downloads': [{ name: 'a.pdf' }, { name: '.cache', hidden: true }],
}

const opened: string[] = []
const picked: string[] = []
const prefs = { hidden: false }

vi.mock('./commands', () => ({
  listFolder: (path: string): Promise<Listing> => {
    const names = DISK[path]
    if (!names) return Promise.reject(new Error(`${path}: Permission denied`))
    return Promise.resolve({
      path,
      parent: null,
      own: false,
      spaces: false,
      cut: false,
      entries: names.map(({ name, hidden = false }) => ({
        name,
        kind: 'file',
        folder: false,
        size: 1,
        modified: 0,
        created: 0,
        hidden,
      })),
    })
  },
}))
vi.mock('./open', () => ({
  openExplorer: (folder: string) => {
    opened.push(folder)
    return Promise.resolve({ folder })
  },
}))
vi.mock('./prefs.svelte', () => ({ explorerPrefs: prefs }))
vi.mock('./view.svelte', () => ({
  viewOf: () => ({ pickOnArrival: (name: string) => picked.push(name) }),
}))

const { showInExplorer } = await import('./reveal')

beforeEach(() => {
  opened.length = 0
  picked.length = 0
  prefs.hidden = false
})

describe('showing a file in the Orden explorer', () => {
  test('opens its folder with the file picked', async () => {
    expect(await showInExplorer('/home/me/Downloads/a.pdf')).toBe(true)
    expect(opened).toEqual(['/home/me/Downloads'])
    expect(picked).toEqual(['a.pdf'])
  })

  test('says no for a folder it cannot list, or a file not there, opening nothing', async () => {
    expect(await showInExplorer('/root/secret/a.pdf')).toBe(false)
    expect(await showInExplorer('/home/me/Downloads/gone.pdf')).toBe(false)
    expect(await showInExplorer('/')).toBe(false)
    expect(opened).toEqual([])
  })

  test('says no for a hidden file while hidden files are not shown', async () => {
    expect(await showInExplorer('/home/me/Downloads/.cache')).toBe(false)
    prefs.hidden = true
    expect(await showInExplorer('/home/me/Downloads/.cache')).toBe(true)
    expect(picked).toEqual(['.cache'])
  })
})
