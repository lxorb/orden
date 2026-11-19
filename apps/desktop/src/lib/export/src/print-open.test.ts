import { beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  kind: 'canvas',
  trusted: true,
  printed: [] as unknown[],
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    get active() {
      return { kind: world.kind, note: {} }
    },
  },
}))
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  openOut: () => ({
    text: '{}',
    name: 'Board.canvas',
    path: '/space/Board.canvas',
    root: '/space',
    shared: null,
    trusted: world.trusted,
  }),
}))
vi.mock('./print', () => ({ printNote: () => Promise.resolve() }))
vi.mock('../../plane/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../plane/src/api')>()),
  drawingOf: (open: unknown) => open,
  printCanvas: (drawing: unknown) => {
    world.printed.push(drawing)
    return Promise.resolve()
  },
}))
vi.mock('../../pages/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pages/src/api')>()),
  pagesOut: () =>
    Promise.resolve({
      pagesOutOf: (open: unknown) => open,
      printPages: (out: unknown) => {
        world.printed.push(out)
        return Promise.resolve()
      },
    }),
}))
const { printOpen } = await import('./print-open')
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
