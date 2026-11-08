import { linearly } from '../../../../../../scripts/growth'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/caller'

const tabs: { id: string; kind: string; path: null }[] = [
  { id: 'e1', kind: 'explorer', path: null },
]
const recorded: unknown[] = []
vi.mock('../../workspace.svelte', () => ({
  workspace: {
    get tabs() {
      return tabs
    },
    spaces: [{ root: '/home/me/Orden/Work' }],
    undone: { record: (one: unknown) => recorded.push(one) },
  },
}))

interface FakeView {
  listing: { path: string; own: boolean; spaces: boolean }
  folder: string
  rows: { name: string; folder: boolean; size: number; modified: number }[]
  chosen: string[]
  search: null
  picked: string[]
  went: string[]
  wrong: string | null
  appear: () => Promise<void>
  go: (folder: string) => Promise<void>
  pathOf: (name: string) => string
  pickNames: (names: string[]) => void
  reload: () => Promise<void>
  tell: (words: string) => void
}

function fakeView(): FakeView {
  const made: FakeView = {
    listing: { path: '/home/me/Downloads', own: false, spaces: false },
    folder: '/home/me/Downloads',
    rows: [
      { name: 'a.zip', folder: false, size: 3, modified: 0 },
      { name: 'b.pdf', folder: false, size: 4, modified: 0 },
    ],
    chosen: [],
    search: null,
    picked: [],
    went: [],
    wrong: null,
    appear: () => Promise.resolve(),
    go: (folder: string) => {
      made.went.push(folder)
      made.listing = { ...made.listing, path: folder }
      return Promise.resolve()
    },
    pathOf: (name: string) => `${made.listing.path}/${name}`,
    pickNames: (names: string[]) => {
      made.picked = names
    },
    reload: () => Promise.resolve(),
    tell: () => undefined,
  }
  return made
}

let view = fakeView()
vi.mock('../../explorer/view.svelte', () => ({ viewOf: () => view }))

const trashed: string[][] = []
const carried: { paths: string[]; to: string; how: string }[] = []
vi.mock('../../explorer/changes', () => ({
  changeable: () => true,
  trash: (_view: unknown, paths: string[]) => {
    trashed.push(paths)
    return Promise.resolve()
  },
  carry: (_view: unknown, paths: string[], to: string, how: string) => {
    carried.push({ paths, to, how })
    return Promise.resolve()
  },
  renamePath: () => Promise.resolve(),
}))

vi.mock('../../explorer/commands', () => ({
  listFolder: (path: string) =>
    Promise.resolve({ path, own: path.includes('.config/orden'), spaces: false, entries: [] }),
  makeIn: (folder: string, name: string) => Promise.resolve(`${folder}/${name}`),
}))

vi.mock('../../explorer/places.svelte', () => ({
  places: { home: () => Promise.resolve('/home/me') },
}))

const asked: { command: string; args: Record<string, unknown> }[] = []
vi.mock('../../tauri', () => ({
  platform: () => 'linux',
  joinPath: (dir: string, rest: string) => `${dir}/${rest}`,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    return Promise.resolve({ status: 'ok', result: {} })
  },
}))

const { explorerTabs, namesAt } = await import('./explorer')

function call(args: Record<string, unknown>, mode = 'confirm') {
  return explorerTabs({
    verb: 'explorer_tabs',
    args,
    caller: callerOf({ id: 'claude', name: 'Claude', scopes: ['files'], mode }),
  }).catch((error: unknown) => error)
}

beforeEach(() => {
  view = fakeView()
  asked.length = 0
  trashed.length = 0
  carried.length = 0
  recorded.length = 0
})

describe("an agent's file explorer", () => {
  test('lists the tabs and what each shows, marked as the disk’s words', async () => {
    expect(await call({ op: 'list' })).toMatchObject({
      result: { tabs: [{ tab: 'e1', folder: '/home/me/Downloads' }] },
      untrusted: 'the names of files on this computer',
    })
  })

  test('goes to a folder under ~/, asking first as files outside the spaces do', async () => {
    expect(await call({ op: 'go', tab: 'e1', path: '~/Music' })).toMatchObject({ status: 'ok' })
    expect(view.went).toEqual(['/home/me/Music'])
    expect(asked[0]).toMatchObject({
      command: 'agents_ask',
      args: { category: 'files', site: '/home/me/Music' },
    })
  })

  test('never reaches Orden’s own folder', async () => {
    expect(await call({ op: 'go', tab: 'e1', path: '~/.config/orden' })).toMatchObject({
      code: 'not_granted',
    })
    expect(view.went).toEqual([])
  })

  test('picks a thousand of a thousand rows without comparing each with each', () => {
    const names = Array.from({ length: 4000 }, (_, at) => `File ${at}.txt`)
    const picked = linearly((count) => {
      const rows = names.slice(0, count).map((name) => ({ name }))
      const paths = names.slice(0, count).map((name) => `/home/me/Downloads/${name}`)
      return namesAt(rows, (name) => `/home/me/Downloads/${name}`, paths, true)
    }, 4000)
    expect(picked).toHaveLength(4000)
  })

  test('names at most 1000 paths at once, and asks about none past that', async () => {
    const many = Array.from({ length: 1001 }, (_, at) => `f${at}.txt`)
    for (const op of ['select', 'trash', 'copy']) {
      expect(await call({ op, tab: 'e1', paths: many, to: '~/Documents' }), op).toMatchObject({
        code: 'bad_arguments',
      })
    }
    expect(trashed).toEqual([])
    expect(carried).toEqual([])
  })

  test('picks and trashes through the tab, so the reader can undo it', async () => {
    await call({ op: 'select', tab: 'e1', paths: ['a.zip'] })
    expect(view.picked).toEqual(['a.zip'])
    expect(await call({ op: 'trash', tab: 'e1', paths: ['a.zip'] })).toMatchObject({ status: 'ok' })
    expect(trashed).toEqual([['/home/me/Downloads/a.zip']])
    expect(asked.at(-1)).toMatchObject({ args: { category: 'trashing' } })
  })

  test('moves and copies outside the spaces only, and sends a space’s files to the note tools', async () => {
    await call({ op: 'copy', tab: 'e1', paths: ['b.pdf'], to: '~/Documents' })
    expect(carried).toEqual([
      { paths: ['/home/me/Downloads/b.pdf'], to: '/home/me/Documents', how: 'copy' },
    ])
    const refused = await call({
      op: 'move',
      tab: 'e1',
      paths: ['b.pdf'],
      to: '/home/me/Orden/Work/Inbox',
    })
    expect(refused).toMatchObject({ code: 'not_granted' })
    expect(carried).toHaveLength(1)
  })

  test('makes a folder that one undo takes away again', async () => {
    await call({ op: 'mkdir', tab: 'e1', name: 'Scans' }, 'unsupervised')
    expect(recorded).toEqual([
      { kind: 'outside', steps: [{ op: 'made', path: '/home/me/Downloads/Scans' }] },
    ])
  })
})
