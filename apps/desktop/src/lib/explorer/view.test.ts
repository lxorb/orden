import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Listing } from './commands'

const DISK: Record<string, string[]> = {
  '/home/me': ['Music', 'Pictures', 'notes.txt'],
  '/home/me/Pictures': ['a.png'],
  '/home/me/Music': [],
  '/home': ['me'],
}

const listed: string[] = []

vi.mock('./commands', () => ({
  CHANGED: 'explorer://changed',
  listFolder: (path: string): Promise<Listing> => {
    listed.push(path)
    const names = DISK[path]
    if (!names) return Promise.reject(new Error(`${path}: No such file or directory`))
    return Promise.resolve({
      path,
      parent: null,
      own: false,
      spaces: false,
      cut: false,
      entries: names.map((name) => ({
        name,
        kind: name.includes('.') ? 'file' : 'folder',
        folder: !name.includes('.'),
        size: 1,
        modified: 0,
        hidden: false,
      })),
    })
  },
  watchFolder: () => Promise.resolve(),
  unwatchFolder: () => Promise.resolve(),
  listPlaces: () => Promise.resolve([{ kind: 'home', path: '/home/me', name: null }]),
}))

const scheduleSession = vi.fn()
vi.mock('../workspace.svelte', () => ({ workspace: { scheduleSession, tabs: [] } }))

const { viewOf } = await import('./view.svelte')
const { readSpec } = await import('./spec')

function tabWith(doc: string) {
  const tab = {
    doc,
    name: '',
    note: {
      replace(words: string) {
        tab.doc = words
      },
    },
  }
  return tab
}

beforeEach(() => {
  listed.length = 0
})

describe('a file explorer', () => {
  test('opens on the home folder, and is named and written down as it goes', async () => {
    const tab = tabWith('')
    const view = viewOf(tab as never)
    await view.appear()
    expect(view.folder).toBe('/home/me')
    expect(view.names).toEqual(['Music', 'Pictures', 'notes.txt'])
    expect(tab.name).toBe('me')
    await view.go('/home/me/Pictures')
    expect(readSpec(tab.doc)).toEqual({
      folder: '/home/me/Pictures',
      back: ['/home/me'],
      ahead: [],
    })
    expect(scheduleSession).toHaveBeenCalled()
  })

  test('goes back and forward, and up with the folder it left picked', async () => {
    const view = viewOf(
      tabWith('{"folder":"/home/me/Pictures","back":["/home/me"],"ahead":[]}') as never,
    )
    await view.appear()
    await view.back()
    expect(view.folder).toBe('/home/me')
    expect(view.canGoForward).toBe(true)
    await view.forward()
    expect(view.folder).toBe('/home/me/Pictures')
    await view.up()
    expect(view.folder).toBe('/home/me')
    expect(view.picked.cursor).toBe('Pictures')
    expect(view.chosen).toEqual(['/home/me/Pictures'])
  })

  test('stays where it was, saying why, when a folder will not list', async () => {
    const tab = tabWith('')
    const view = viewOf(tab as never)
    await view.appear()
    const before = tab.doc
    await view.go('/gone')
    expect(view.folder).toBe('/home/me')
    expect(view.wrong).toContain('No such file')
    expect(tab.doc).toBe(before)
  })

  test('lists again only for a change in the folder on screen', async () => {
    const view = viewOf(tabWith('') as never)
    await view.appear()
    listed.length = 0
    view.heard(['/home/me/Music'])
    view.heard(['/home/me'])
    await Promise.resolve()
    expect(listed).toEqual(['/home/me'])
  })
})
