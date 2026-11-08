import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  meanwhile: null as (() => void) | null,
  stored: 0,
  pages: 2,
  full: 0,
  sizes: [] as { width: number; height: number }[],
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

const paper = {
  createElement: () => {
    const sheet = { width: 0, height: 0 }
    world.sizes.push(sheet)
    return Object.assign(sheet, {
      getContext: () => ({}),
      toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })),
    })
  },
}

vi.mock('../prompt.svelte', () => ({ prompt: { choose: () => Promise.resolve('all') } }))
vi.mock('../assets', () => ({
  accountAddress: () => null,
  storeImage: () => {
    if (world.full && world.stored >= world.full)
      return Promise.reject(new Error('The account is out of space'))
    world.stored += 1
    return Promise.resolve(`/space/assets/page-${String(world.stored)}.png`)
  },
}))
vi.mock('../pdf/document', () => ({
  loading: (library: { getDocument: (source: object) => unknown }, data: Uint8Array) =>
    library.getDocument({ data }),
  pdfjs: () =>
    Promise.resolve({
      getDocument: () => ({
        promise: Promise.resolve({
          get numPages() {
            return world.pages
          },
          getPage: (number: number) =>
            Promise.resolve({
              getViewport: ({ scale }: { scale: number }) =>
                number === 3
                  ? { width: 20 * scale, height: 90_000 * scale }
                  : { width: 600, height: 800 },
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
  world.pages = 2
  world.full = 0
  world.sizes = []
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

async function dropped(store: ReturnType<typeof board>) {
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
}

test('a long strip of a page is drawn within what a canvas can hold', async () => {
  world.pages = 3
  await dropped(board())

  expect(world.sizes).toHaveLength(3)
  for (const size of world.sizes) {
    expect(size.height).toBeGreaterThan(0)
    expect(size.height).toBeLessThanOrEqual(16384)
  }
})

test('pages stored before the space runs out are placed, and the reader is told', async () => {
  const { busy } = await import('../busy.svelte')
  world.pages = 5
  world.full = 2
  const store = board()

  await dropped(store)

  expect(store.canvas.nodes.filter((node) => node.type === 'file')).toHaveLength(2)
  expect(busy.trouble).toMatch(/out of space/)
  expect(busy.active).toBe(false)
})

test('files dropped together are laid one below another, none over the last, and all picked', async () => {
  const store = board()
  const picture = (name: string) => new File(['png'], name, { type: 'image/png' })
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'Lecture.pdf', {
    type: 'application/pdf',
  })
  vi.stubGlobal('document', paper)
  try {
    await run.dropFiles(
      store,
      [picture('a.png'), pdf, picture('b.png')],
      { x: 0, y: 0 },
      '/space/Board.canvas',
    )
  } finally {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  }

  const cards = store.canvas.nodes.filter((node) => node.type === 'file')
  expect(cards).toHaveLength(4)
  const tops = [...cards].sort((one, other) => one.y - other.y)
  for (const [index, card] of tops.slice(1).entries()) {
    const above = tops[index]!
    expect(card.y).toBeGreaterThanOrEqual(above.y + above.height)
  }
  expect([...store.picked].sort()).toEqual(cards.map((card) => card.id).sort())
})

test('a picture that finds the space full says so instead of vanishing', async () => {
  const { busy } = await import('../busy.svelte')
  busy.clear()
  world.full = 1
  world.stored = 1
  const store = board()

  const made = await run.dropImage(
    store,
    new File(['png'], 'a.png', { type: 'image/png' }),
    { x: 0, y: 0 },
    '/space/Board.canvas',
  )

  expect(made).toEqual([])
  expect(store.canvas.nodes).toHaveLength(0)
  expect(busy.trouble).toMatch(/out of space/)
})

test('a picture added to a canvas keeps its own shape instead of being cut to a landscape card', async () => {
  const store = board()
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 1080, height: 2400, close: () => undefined }),
  )
  try {
    await run.dropImage(
      store,
      new File(['png'], 'phone.png', { type: 'image/png' }),
      { x: 0, y: 0 },
      '/space/Board.canvas',
    )
  } finally {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  }

  const [card] = store.canvas.nodes
  expect(card?.height).toBe(320)
  expect(card?.width).toBe(144)
})

test('a tiny picture is drawn big enough to take hold of', async () => {
  const store = board()
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 16, height: 8, close: () => undefined }),
  )
  try {
    await run.dropImage(
      store,
      new File(['png'], 'icon.png', { type: 'image/png' }),
      { x: 0, y: 0 },
      '/space/Board.canvas',
    )
  } finally {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  }

  const [card] = store.canvas.nodes
  expect(card?.width).toBe(80)
  expect(card?.height).toBe(40)
})
