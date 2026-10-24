import { beforeEach, expect, test, vi } from 'vitest'

/** A canvas or a page note in a space shared to be read (B370). The store refuses every
 *  edit, so anything that opens a card for typing, asks a question or stores a picture
 *  first only takes the reader's words or a file and then drops them. Nothing of that
 *  starts at all. */

const asked = vi.hoisted(() => ({ prompts: 0, stored: 0 }))

vi.mock('../prompt.svelte', () => ({
  prompt: {
    ask: () => {
      asked.prompts += 1
      return Promise.resolve('typed')
    },
    find: () => {
      asked.prompts += 1
      return Promise.resolve('Note.md')
    },
    choose: () => {
      asked.prompts += 1
      return Promise.resolve('single')
    },
  },
}))
vi.mock('../assets', () => ({
  accountAddress: () => null,
  storeImage: () => {
    asked.stored += 1
    return Promise.resolve('/space/assets/picture.png')
  },
}))

vi.mock('../pdf/document', () => ({ pdfjs: () => Promise.reject(new Error('no PDF here')) }))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { run, place, putWords } = await import('./actions')
const { CanvasStore } = await import('./store.svelte')
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { workspace } = await import('../workspace.svelte')

function readOnlyBoard() {
  const text = JSON.stringify({
    nodes: [
      { id: 'card', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'owner words' },
      { id: 'frame', type: 'group', x: 0, y: 100, width: 400, height: 300 },
    ],
    edges: [{ id: 'line', fromNode: 'card', toNode: 'frame' }],
  })
  const note = new NoteDoc(
    { kind: 'canvas', path: '/space/Board.canvas', name: 'Board.canvas', text, dirty: false },
    () => undefined,
  )
  const store = new CanvasStore(new Tab(note, 'pane'))
  store.readOnly = true
  return store
}

const picture = () => new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
const pdf = () => new File([new Uint8Array([37])], 'a.pdf', { type: 'application/pdf' })

beforeEach(() => {
  asked.prompts = 0
  asked.stored = 0
  workspace.spaces = [{ id: 'local', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 'local'
})

test('a double click on a card does not open it for typing', async () => {
  const store = readOnlyBoard()
  await run.open(store, { node: 'card', edge: null } as never, { x: 10, y: 10 })
  expect(store.editing).toBeNull()
})

test('a double click on a frame or a line asks for no name', async () => {
  const store = readOnlyBoard()
  await run.open(store, { node: 'frame', edge: null } as never, { x: 10, y: 110 })
  await run.open(store, { node: null, edge: 'line' } as never, { x: 10, y: 80 })
  expect(asked.prompts).toBe(0)
})

test('a tool pressed on the plane asks nothing and opens nothing', async () => {
  const store = readOnlyBoard()
  await place(store, 'file', { x: 0, y: 0 }, { colour: '', path: store.path })
  putWords(store, { x: 0, y: 0, width: 200, height: 40 })
  expect(asked.prompts).toBe(0)
  expect(store.editing).toBeNull()
})

test('a picture or a PDF dropped or pasted is not stored', async () => {
  const store = readOnlyBoard()
  await run.dropImage(store, picture(), { x: 0, y: 0 }, store.path)
  await run.dropPdf(store, pdf(), { x: 0, y: 0 }, store.path)
  expect(asked.stored).toBe(0)
  expect(asked.prompts).toBe(0)
})
