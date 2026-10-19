import { beforeEach, expect, test, vi } from 'vitest'

/** A PDF dropped on a canvas, All pages (#532): the pages are rendered one by one, many
 *  awaits long, and the plane laid out as it stood when the import began was written
 *  back at the end - a card drawn meanwhile, or one another device's words brought in,
 *  was gone, and recorded as deleted, so the deletion went to every other device too.
 *  The pages go onto the plane as it is once they are rendered. */

const world = vi.hoisted(() => ({
  /** Run while the second page renders: what happens to the plane meanwhile. */
  meanwhile: null as (() => void) | null,
  stored: 0,
}))

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

/** The canvas a page is rendered on, for the one call that asks for it: the editor's
 *  modules read `document` as they load, so it is put in place only for the import. */
const paper = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({}),
    toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })),
  }),
}

vi.mock('../prompt.svelte', () => ({ prompt: { choose: () => Promise.resolve('all') } }))
vi.mock('../assets', () => ({
  accountAddress: () => null,
  storeImage: () => {
    world.stored += 1
    return Promise.resolve(`/space/assets/page-${String(world.stored)}.png`)
  },
}))
vi.mock('../pdf/document', () => ({
  pdfjs: () =>
    Promise.resolve({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: (number: number) =>
            Promise.resolve({
              getViewport: () => ({ width: 600, height: 800 }),
              render: () => ({
                promise: (async () => {
                  if (number === 2) world.meanwhile?.()
                  await Promise.resolve()
                })(),
              }),
              cleanup: () => undefined,
            }),
        }),
        destroy: () => Promise.resolve(),
      }),
    }),
}))

const { run } = await import('./actions')
const { CanvasStore } = await import('./store.svelte')
const { blankCanvas } = await import('./format')
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { workspace } = await import('../workspace.svelte')

function board() {
  const note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: blankCanvas(),
      dirty: false,
    },
    () => undefined,
  )
  return new CanvasStore(new Tab(note, 'pane'))
}

beforeEach(() => {
  world.meanwhile = null
  world.stored = 0
  workspace.spaces = [{ id: 'local', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 'local'
})

test('a card drawn while the pages render is kept, beside every page', async () => {
  const store = board()
  world.meanwhile = () => {
    store.edit({
      ...store.canvas,
      nodes: [
        ...store.canvas.nodes,
        { id: 'mine', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'drawn meanwhile' },
      ],
    })
  }

  const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'Lecture.pdf', {
    type: 'application/pdf',
  })
  vi.stubGlobal('document', paper)
  try {
    await run.dropPdf(store, pdf, { x: 0, y: 0 }, '/space/Board.canvas')
  } finally {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  }

  const ids = store.canvas.nodes.map((node) => node.id)
  expect(ids).toContain('mine')
  expect(store.canvas.nodes.filter((node) => node.type === 'file')).toHaveLength(2)
  expect(store.canvas.gone).not.toHaveProperty('mine')
})
