import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  kind: 'canvas',
  trusted: true,
  printed: [] as unknown[],
}))

vi.mock('./workspace/src/api', () => ({
  workspace: {
    get active() {
      return { kind: world.kind, note: {} }
    },
  },
}))
vi.mock('./export/src/api', () => ({
  openOut: () => ({
    text: '{}',
    name: 'Board.canvas',
    path: '/space/Board.canvas',
    root: '/space',
    shared: null,
    trusted: world.trusted,
  }),
  printNote: () => Promise.resolve(),
}))
vi.mock('./plane/src/picture', () => ({
  printCanvas: (drawing: unknown) => {
    world.printed.push(drawing)
    return Promise.resolve()
  },
}))
vi.mock('./pages/src/out', () => ({
  pagesOutOf: (open: unknown) => open,
  printPages: (out: unknown) => {
    world.printed.push(out)
    return Promise.resolve()
  },
}))
vi.mock('./plane/src/drawing', () => ({
  drawingOf: (open: unknown) => open,
}))

const { printOpen } = await import('./open-out')

beforeEach(() => {
  world.printed = []
})

test.each([
  ['canvas', true],
  ['canvas', false],
  ['pages', true],
  ['pages', false],
])('a %s prints with the answer the open document gives: %s', async (kind, trusted) => {
  world.kind = kind
  world.trusted = trusted
  await printOpen()
  expect(world.printed).toEqual([expect.objectContaining({ trusted })])
})
