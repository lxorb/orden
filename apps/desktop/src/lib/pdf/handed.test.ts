import { beforeEach, expect, test, vi } from 'vitest'

interface World {
  asked: string[]
  waiting: unknown
  heard: ((event: { payload: unknown }) => void) | null
  done: string[]
  active: string | null
  same: string | null
  readOnly: string[]
}

const world = vi.hoisted((): World => ({
  asked: [],
  waiting: [],
  heard: null,
  done: [],
  active: 'work',
  same: null,
  readOnly: [],
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'work', name: 'Work', root: 'C:\\Nib\\Work' },
      { id: 'home', name: 'Home', root: 'C:\\Nib\\Home' },
    ],
    get activeSpaceId() {
      return world.active
    },
    selectSpace: (id: string) => {
      world.done.push(`space ${id}`)
      world.active = id
      return Promise.resolve()
    },
    samePdfIn: (from: string, root: string) => {
      world.done.push(`look for ${from} in ${root}`)
      return Promise.resolve(world.same)
    },
    draftPdf: (from: string) => {
      world.done.push(`draft ${from}`)
      return Promise.resolve()
    },
    openPdf: (path: string) => {
      world.done.push(`open ${path}`)
    },
  },
}))

vi.mock('../tauri', async (actual) => ({
  ...(await actual<typeof import('../tauri')>()),
  invoke: (command: string) => {
    world.asked.push(command)
    return Promise.resolve(world.waiting)
  },
}))

vi.mock('../log', () => ({ log: () => undefined }))

vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) => !world.readOnly.some((root) => path.startsWith(root)),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: (event: string, handler: (event: { payload: unknown }) => void) => {
      world.asked.push(`listen ${event}`)
      world.heard = handler
      return Promise.resolve(() => undefined)
    },
  }),
}))

const { hearPdfs, showPdfs } = await import('./handed')

beforeEach(() => {
  world.asked = []
  world.waiting = []
  world.heard = null
  world.done = []
  world.active = 'work'
  world.same = null
  world.readOnly = []
})

test('listens before it asks, so no PDF falls between the two', async () => {
  await hearPdfs()
  expect(world.asked).toEqual(['listen nib://open-pdfs', 'take_startup_pdfs'])
})

test('a PDF from outside every space opens unsaved, and the open space is left alone', async () => {
  world.waiting = ['C:\\Users\\me\\Downloads\\a.pdf']
  await hearPdfs()
  await vi.waitFor(() => expect(world.done).toHaveLength(2))

  expect(world.done).toEqual([
    'look for C:\\Users\\me\\Downloads\\a.pdf in C:\\Nib\\Work',
    'draft C:\\Users\\me\\Downloads\\a.pdf',
  ])
})

test('one the open space already holds opens as that copy', async () => {
  world.same = 'C:\\Nib\\Work\\Papers\\Read.pdf'
  await showPdfs(['C:\\Users\\me\\Downloads\\a.pdf'])

  expect(world.done).toEqual([
    'look for C:\\Users\\me\\Downloads\\a.pdf in C:\\Nib\\Work',
    'open C:\\Nib\\Work\\Papers\\Read.pdf',
  ])
})

test('one in another space opens where it is, in that space, while the app runs', async () => {
  await hearPdfs()
  world.heard?.({ payload: ['C:\\Nib\\Home\\Papers\\b.pdf'] })
  await vi.waitFor(() => expect(world.done).toHaveLength(2))

  expect(world.done).toEqual(['space home', 'open C:\\Nib\\Home\\Papers\\b.pdf'])
})

test('nothing but paths is read', async () => {
  await showPdfs(['C:\\Users\\me\\Downloads\\big.pdf', 42, null, ''])
  await showPdfs('C:\\not-a-list.pdf')

  expect(world.done).toEqual([
    'look for C:\\Users\\me\\Downloads\\big.pdf in C:\\Nib\\Work',
    'draft C:\\Users\\me\\Downloads\\big.pdf',
  ])
})

test('a PDF from outside goes past a space shared to be read, to one that is not', async () => {
  world.readOnly = ['C:\\Nib\\Work']
  await showPdfs(['C:\\Users\\me\\Downloads\\a.pdf'])

  expect(world.done).toEqual([
    'space home',
    'look for C:\\Users\\me\\Downloads\\a.pdf in C:\\Nib\\Home',
    'draft C:\\Users\\me\\Downloads\\a.pdf',
  ])
})

test('with every space shared to be read, it still opens unsaved', async () => {
  world.readOnly = ['C:\\Nib\\Work', 'C:\\Nib\\Home']
  await showPdfs(['C:\\Users\\me\\Downloads\\a.pdf'])

  expect(world.done).toEqual(['draft C:\\Users\\me\\Downloads\\a.pdf'])
})
