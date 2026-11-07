import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Listing } from './commands'

const DISK: Record<string, string[]> = {
  '/home/me': ['Music', 'Pictures', 'notes.txt'],
  '/home/me/Pictures': ['a.png'],
  '/home/me/Music': [],
  '/home': ['me'],
}

const listed: string[] = []
const watched: string[] = []

const slow = new Map<string, Promise<void>>()

function held(path: string): () => void {
  let free: () => void = () => undefined
  slow.set(
    path,
    new Promise((done) => {
      free = done
    }),
  )
  return () => {
    slow.delete(path)
    free()
  }
}

vi.mock('./commands', () => ({
  CHANGED: 'explorer://changed',
  listFolder: (path: string): Promise<Listing> => {
    listed.push(path)
    const names = DISK[path]
    const waited = slow.get(path) ?? Promise.resolve()
    if (!names)
      return waited.then(() => Promise.reject(new Error(`${path}: No such file or directory`)))
    return waited.then(() => ({
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
    }))
  },
  watchFolder: (path: string) => {
    watched.push(path)
    return Promise.resolve()
  },
  unwatchFolder: () => Promise.resolve(),
  listPlaces: () => Promise.resolve([{ kind: 'home', path: '/home/me', name: null }]),
}))

const scheduleSession = vi.fn()
vi.mock('../workspace.svelte', () => ({ workspace: { scheduleSession, tabs: [] } }))

const { LIST_WAIT, viewOf } = await import('./view.svelte')
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
  watched.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  slow.clear()
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

  test('chooses only what is picked: a row let go of, or a click beside the rows, leaves nothing to delete', async () => {
    const view = viewOf(tabWith('{"folder":"/home/me","back":[],"ahead":[]}') as never)
    await view.appear()
    view.pick('notes.txt', 'one')
    expect(view.chosen).toEqual(['/home/me/notes.txt'])
    view.pick('notes.txt', 'toggle')
    expect(view.picked.cursor).toBe('notes.txt')
    expect(view.chosen).toEqual([])
    view.pick('Music', 'one')
    view.pickNone()
    expect(view.chosen).toEqual([])
  })

  test('goes to a folder that will not list, saying why, with nothing left of the one it left', async () => {
    const tab = tabWith('')
    const view = viewOf(tab as never)
    await view.appear()
    await view.go('/gone')
    expect(view.folder).toBe('/gone')
    expect(view.wrong).toContain('No such file')
    expect(view.names).toEqual([])
    expect(tab.name).toBe('gone')
    await view.back()
    expect(view.folder).toBe('/home/me')
    expect(view.wrong).toBeNull()
    expect(view.names).toEqual(['Music', 'Pictures', 'notes.txt'])
  })

  test('a folder that never answers is said so after a while, and every folder after it shows', async () => {
    vi.useFakeTimers()
    const view = viewOf(tabWith('') as never)
    await view.appear()
    held('/home/me/Music')
    const going = view.go('/home/me/Music')
    await vi.advanceTimersByTimeAsync(LIST_WAIT)
    await going
    expect(view.folder).toBe('/home/me/Music')
    expect(view.wrong).toBe('Music did not answer.')
    expect(view.names).toEqual([])
    await view.go('/home/me/Pictures')
    expect(view.folder).toBe('/home/me/Pictures')
    expect(view.wrong).toBeNull()
    expect(view.names).toEqual(['a.png'])
    await view.go('/home/me')
    expect(view.names).toEqual(['Music', 'Pictures', 'notes.txt'])
  })

  test('a folder that answers late is shown when it does, if nothing was gone to since', async () => {
    vi.useFakeTimers()
    const view = viewOf(tabWith('') as never)
    await view.appear()
    const pictures = held('/home/me/Pictures')
    const going = view.go('/home/me/Pictures')
    await vi.advanceTimersByTimeAsync(LIST_WAIT)
    await going
    expect(view.wrong).toBe('Pictures did not answer.')
    pictures()
    await vi.advanceTimersByTimeAsync(0)
    expect(view.wrong).toBeNull()
    expect(view.names).toEqual(['a.png'])
  })

  test('a rereading that never answers never stops the ones after it', async () => {
    vi.useFakeTimers()
    const view = viewOf(tabWith('') as never)
    await view.appear()
    listed.length = 0
    held('/home/me')
    const first = view.reload()
    await vi.advanceTimersByTimeAsync(LIST_WAIT)
    await first
    slow.delete('/home/me')
    await view.reload()
    expect(listed).toEqual(['/home/me', '/home/me'])
    expect(view.wrong).toBeNull()
    expect(view.names).toEqual(['Music', 'Pictures', 'notes.txt'])
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

  test('ends in the folder gone to last, however slowly the folders before it list', async () => {
    const view = viewOf(tabWith('') as never)
    await view.appear()
    const music = held('/home/me/Music')
    const going = view.go('/home/me/Music')
    const gone = view.go('/home/me/Pictures')
    await gone
    music()
    await going
    expect(view.folder).toBe('/home/me/Pictures')
    expect(view.names).toEqual(['a.png'])
  })

  test('shows the folder it went to, not a slow rereading of the one it left', async () => {
    const view = viewOf(tabWith('') as never)
    await view.appear()
    const home = held('/home/me')
    view.heard(['/home/me'])
    await view.go('/home/me/Pictures')
    home()
    await new Promise((done) => setTimeout(done, 0))
    expect(view.folder).toBe('/home/me/Pictures')
    expect(view.names).toEqual(['a.png'])
  })

  test('a folder that keeps changing is read once at a time, and once more after', async () => {
    const view = viewOf(tabWith('') as never)
    await view.appear()
    listed.length = 0
    const home = held('/home/me')
    const first = view.reload()
    for (let at = 0; at < 50; at += 1) void view.reload()
    expect(listed).toEqual(['/home/me'])
    home()
    await first
    expect(listed).toEqual(['/home/me', '/home/me'])
  })

  test('a folder that lists after its tab was put away is not watched', async () => {
    const view = viewOf(tabWith('') as never)
    await view.appear()
    watched.length = 0
    const music = held('/home/me/Music')
    const going = view.go('/home/me/Music')
    view.stop()
    music()
    await going
    expect(view.folder).toBe('/home/me/Music')
    expect(watched).toEqual([])
  })
})
