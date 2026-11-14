import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  kind: 'canvas',
  trusted: true,
  printed: [] as unknown[],
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get active() {
      return { kind: world.kind, note: {} }
    },
    rootHolding: () => '/space',
  },
}))
vi.mock('./export/src/context', () => ({
  openTarget: () => ({
    source: '{}',
    name: 'Board.canvas',
    path: '/space/Board.canvas',
    trusted: world.trusted,
  }),
  renderOptions: () => Promise.resolve({}),
}))
vi.mock('./plane/src/picture', () => ({
  printCanvas: (drawing: unknown) => {
    world.printed.push(drawing)
    return Promise.resolve()
  },
}))
vi.mock('./pages/out', () => ({
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
