import { beforeEach, expect, test, vi } from 'vitest'
import { plainWords } from '@orden/markdown/escapes'

interface World {
  asked: string[]
  waiting: unknown
  heard: ((event: { payload: unknown }) => void) | null
  done: string[]
  active: string | null
  same: string | null
  readOnly: string[]
  files: Record<string, string>
}
const world = vi.hoisted((): World => ({
  asked: [],
  waiting: [],
  heard: null,
  done: [],
  active: 'work',
  same: null,
  readOnly: [],
  files: {},
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [
      { id: 'work', name: 'Work', root: 'C:\\Orden\\Work' },
      { id: 'home', name: 'Home', root: 'C:\\Orden\\Home' },
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
    open: (path: string) => {
      world.done.push(`open note ${path}`)
      return Promise.resolve()
    },
    openBlank: (name: string, text: string) => {
      world.done.push(`new note ${name}: ${text}`)
    },
  },
}))
vi.mock('../../platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) => {
    world.asked.push(command)
    if (command === 'read_file') {
      const text = world.files[args?.path ?? '']
      return text === undefined
        ? Promise.reject(new Error('not handed'))
        : Promise.resolve(new TextEncoder().encode(text).buffer)
    }
    return Promise.resolve(world.waiting)
  },
}))
vi.mock('../../platform/src/log', () => ({ log: () => undefined }))
vi.mock('../../sharing/src/api', () => ({
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
  world.files = {}
})
test('listens before it asks, so no PDF falls between the two', async () => {
  await hearPdfs()
  expect(world.asked).toEqual(['listen orden://open-pdfs', 'take_startup_pdfs'])
})
test('a PDF from outside every space opens unsaved, and the open space is left alone', async () => {
  world.waiting = ['C:\\Users\\me\\Downloads\\a.pdf']
  await hearPdfs()
  await vi.waitFor(() => expect(world.done).toHaveLength(2))
  expect(world.done).toEqual([
    'look for C:\\Users\\me\\Downloads\\a.pdf in C:\\Orden\\Work',
    'draft C:\\Users\\me\\Downloads\\a.pdf',
  ])
})
test('one the open space already holds opens as that copy', async () => {
  world.same = 'C:\\Orden\\Work\\Papers\\Read.pdf'
  await showPdfs(['C:\\Users\\me\\Downloads\\a.pdf'])
  expect(world.done).toEqual([
    'look for C:\\Users\\me\\Downloads\\a.pdf in C:\\Orden\\Work',
    'open C:\\Orden\\Work\\Papers\\Read.pdf',
  ])
})
test('one in another space opens where it is, in that space, while the app runs', async () => {
  await hearPdfs()
  world.heard?.({ payload: ['C:\\Orden\\Home\\Papers\\b.pdf'] })
  await vi.waitFor(() => expect(world.done).toHaveLength(2))
  expect(world.done).toEqual(['space home', 'open C:\\Orden\\Home\\Papers\\b.pdf'])
})
test('nothing but paths is read', async () => {
  await showPdfs(['C:\\Users\\me\\Downloads\\big.pdf', 42, null, ''])
  await showPdfs('C:\\not-a-list.pdf')
  expect(world.done).toEqual([
    'look for C:\\Users\\me\\Downloads\\big.pdf in C:\\Orden\\Work',
    'draft C:\\Users\\me\\Downloads\\big.pdf',
  ])
})
test('a PDF from outside goes past a space shared to be read, to one that is not', async () => {
  world.readOnly = ['C:\\Orden\\Work']
  await showPdfs(['C:\\Users\\me\\Downloads\\a.pdf'])
  expect(world.done).toEqual([
    'space home',
    'look for C:\\Users\\me\\Downloads\\a.pdf in C:\\Orden\\Home',
    'draft C:\\Users\\me\\Downloads\\a.pdf',
  ])
})
test('with every space shared to be read, it still opens unsaved', async () => {
  world.readOnly = ['C:\\Orden\\Work', 'C:\\Orden\\Home']
  await showPdfs(['C:\\Users\\me\\Downloads\\a.pdf'])
  expect(world.done).toEqual(['draft C:\\Users\\me\\Downloads\\a.pdf'])
})
test('a text file from outside becomes a new note in the open space, its words as they read', async () => {
  world.files = { 'C:\\Users\\me\\list.txt': '# not a heading\nmilk' }
  await showPdfs(['C:\\Users\\me\\list.txt'])
  const words = plainWords('# not a heading\nmilk')
  expect(words).not.toBe('# not a heading\nmilk')
  expect(world.done).toEqual([`new note list: ${words}`])
})
test('a markdown file opens where it is when a space holds it, and comes in as a note when none does', async () => {
  world.files = { 'C:\\Users\\me\\Idea.md': '# Idea' }
  await showPdfs(['C:\\Orden\\Home\\Notes\\Plan.md', 'C:\\Users\\me\\Idea.md'])
  expect(world.done).toEqual(['space home', 'open note C:\\Orden\\Home\\Notes\\Plan.md', 'new note Idea: # Idea'])
})
test('a text file that cannot be read opens nothing', async () => {
  await showPdfs(['C:\\Users\\me\\gone.txt'])
  expect(world.done).toEqual([])
})
