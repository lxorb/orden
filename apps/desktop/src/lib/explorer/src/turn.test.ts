import { providePort } from '@orden/contracts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Listing } from './commands'

const DISK: Record<string, string[]> = {
  '/home/me': ['Music', 'notes.txt'],
  '/home/me/Music': ['a.mp3'],
}
vi.mock('./commands', () => ({
  CHANGED: 'explorer://changed',
  listFolder: (path: string): Promise<Listing> => {
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
        created: 0,
        hidden: false,
      })),
    })
  },
  watchFolder: () => Promise.resolve(),
  unwatchFolder: () => Promise.resolve(),
  listPlaces: () => Promise.resolve([{ kind: 'home', path: '/home/me', name: null }]),
}))
interface Shown {
  id: string
  kind: string
  doc: string
  name: string
  note: { replace: (words: string) => void }
}
const shownAs = (id: string, kind: string, doc: string): Shown => {
  const tab: Shown = {
    id,
    kind,
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
const twins = new Map<string, Shown>()
const turned: unknown[][] = []
const workspace = {
  scheduleSession: vi.fn(),
  tabs: [] as Shown[],
  active: null as Shown | null,
  twinOf: (id: string) => twins.get(id) ?? null,
  turn: (id: string, other?: { kind: string; words: string; title: string }) => {
    turned.push(other ? [id, other] : [id])
    const twin = twins.get(id) ?? (other ? shownAs(`${id}-twin`, other.kind, other.words) : null)
    if (twin) twins.set(id, twin)
    return twin
  },
}
vi.mock('../../workspace/src/api', () => ({ workspace }))
const shell = { busy: false }
const cds: string[][] = []
providePort('terminal.going', {
  goTo: (tabId: string, folder: string) => {
    cds.push([tabId, folder])
    const tab = [...twins.values()].find((one) => one.id === tabId)
    if (shell.busy || !tab) return Promise.resolve(false)
    tab.note.replace(JSON.stringify({ shell: 'bash', folder, key: 'k' }))
    return Promise.resolve(true)
  },
})
const { turnExplorer, turnLabel, turnTab } = await import('./turn')
const { viewOf } = await import('./view.svelte')
const { readSpec } = await import('./spec')
async function explorerAt(id: string, folder: string) {
  const tab = shownAs(id, 'explorer', JSON.stringify({ folder }))
  const view = viewOf(tab as never)
  await view.appear()
  return { tab, view }
}
async function shownAgain(view: ReturnType<typeof viewOf>) {
  view.stop()
  await view.appear()
}
beforeEach(() => {
  twins.clear()
  turned.length = 0
  cds.length = 0
  shell.busy = false
  workspace.active = null
})
test('a terminal turned into an explorer writes only its folder, and the explorer reads that as a fresh way', () => {
  expect(readSpec('{"folder":"/home/me"}')).toEqual({ folder: '/home/me', back: [], ahead: [] })
})
describe('turning an explorer', () => {
  test('with no terminal beside it opens one in the folder it shows', async () => {
    const { tab } = await explorerAt('e1', '/home/me')
    expect(turnLabel(tab as never)).toBe('Terminal here')
    turnTab(tab as never)
    expect(turned).toEqual([['e1', { kind: 'terminal', words: '{"folder":"/home/me"}', title: 'Terminal' }]])
    expect(turnLabel(tab as never)).toBe('Back to the terminal')
  })
  test('with its terminal beside it goes back to that same terminal', async () => {
    const { tab } = await explorerAt('e2', '/home/me')
    twins.set('e2', shownAs('t2', 'terminal', '{"shell":"bash","folder":"/srv","key":"k"}'))
    turnTab(tab as never)
    expect(turned).toEqual([['e2']])
    await vi.waitFor(() => expect(cds).toEqual([['t2', '/home/me']]))
  })
  test('asks nothing of a terminal already in its folder', async () => {
    const { tab } = await explorerAt('e7', '/home/me')
    twins.set('e7', shownAs('t7', 'terminal', '{"shell":"bash","folder":"/home/me","key":"k"}'))
    turnTab(tab as never)
    await Promise.resolve()
    expect(cds).toEqual([])
  })
  test('comes back where the terminal went, with the way back kept', async () => {
    const { tab, view } = await explorerAt('e3', '/home/me')
    turnTab(tab as never)
    twins.get('e3')?.note.replace('{"shell":"bash","folder":"/home/me/Music","key":"k"}')
    await shownAgain(view)
    expect(view.folder).toBe('/home/me/Music')
    expect(view.names).toEqual(['a.mp3'])
    expect(view.canGoBack).toBe(true)
    await view.back()
    expect(view.folder).toBe('/home/me')
  })
  test('takes the terminal to a folder it went to after the last turn, and both stay there', async () => {
    const { tab, view } = await explorerAt('e4', '/home/me')
    twins.set('e4', shownAs('t4', 'terminal', '{"shell":"bash","folder":"/home/me","key":"k"}'))
    turnTab(tab as never)
    await shownAgain(view)
    await view.go('/home/me/Music')
    turnTab(tab as never)
    await vi.waitFor(() => expect(cds).toEqual([['t4', '/home/me/Music']]))
    await shownAgain(view)
    expect(view.folder).toBe('/home/me/Music')
  })
  test('follows a terminal busy with a program that could not move, with the way back kept', async () => {
    const { tab, view } = await explorerAt('e8', '/home/me')
    await view.go('/home/me/Music')
    twins.set('e8', shownAs('t8', 'terminal', '{"shell":"bash","folder":"/home/me","key":"k"}'))
    shell.busy = true
    turnTab(tab as never)
    await vi.waitFor(() => expect(cds).toEqual([['t8', '/home/me/Music']]))
    await shownAgain(view)
    expect(view.folder).toBe('/home/me')
    await view.back()
    expect(view.folder).toBe('/home/me/Music')
  })
  test('keeps its own folder when it was never turned away', async () => {
    const { view } = await explorerAt('e5', '/home/me')
    twins.set('e5', shownAs('t5', 'terminal', '{"shell":"bash","folder":"/home/me/Music","key":"k"}'))
    await shownAgain(view)
    expect(view.folder).toBe('/home/me')
  })
  test('by command turns only an explorer in sight', async () => {
    const { tab } = await explorerAt('e6', '/home/me')
    workspace.active = shownAs('n6', 'note', '')
    turnExplorer()
    expect(turned).toEqual([])
    workspace.active = tab
    turnExplorer()
    expect(turned).toEqual([['e6', { kind: 'terminal', words: '{"folder":"/home/me"}', title: 'Terminal' }]])
  })
})
