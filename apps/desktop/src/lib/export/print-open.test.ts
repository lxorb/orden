import { beforeEach, expect, test, vi } from 'vitest'

/** Printing what is open asks the same question of a plane's or a page note's HTML as
 *  the surface and the Export menu do (#612). The drawing itself is stood in for. */
const world = vi.hoisted(() => ({
  kind: 'canvas',
  trusted: true,
  printed: [] as unknown[],
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    get active() {
      return { kind: world.kind, note: {} }
    },
    rootHolding: () => '/space',
  },
}))
vi.mock('./context', () => ({
  openTarget: () => ({
    source: '{}',
    name: 'Board.canvas',
    path: '/space/Board.canvas',
    trusted: world.trusted,
  }),
  renderOptions: () => Promise.resolve({}),
}))
vi.mock('../canvas/picture', () => ({
  printCanvas: (drawing: unknown) => {
    world.printed.push(drawing)
    return Promise.resolve()
  },
}))
vi.mock('../pages/out', () => ({
  pagesOutOf: (open: unknown) => open,
  printPages: (out: unknown) => {
    world.printed.push(out)
    return Promise.resolve()
  },
}))
vi.mock('./drawing', () => ({
  drawingOf: (open: unknown) => open,
}))

const { printOpen } = await import('./print')

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
