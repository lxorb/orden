import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ trusted: true }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    get active() {
      return {
        kind: 'canvas',
        doc: '{}',
        name: 'Board.canvas',
        path: '/space/Board.canvas',
        note: { shared: null },
      }
    },
    protection: { locked: () => false },
    rootHolding: () => '/space',
    wordsNow: () => undefined,
  },
}))
vi.mock('../../sharing/src/api', () => ({ trustsHtmlIn: () => world.trusted }))
const { openOut } = await import('./context')
test.each([true, false])('the open document goes out saying whether it is trusted: %s', (trusted) => {
  world.trusted = trusted
  expect(openOut()).toEqual({
    text: '{}',
    name: 'Board.canvas',
    path: '/space/Board.canvas',
    root: '/space',
    shared: null,
    trusted,
  })
})
