// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { providePort, type PlaneShown } from '@orden/contracts'

const asked: PlaneShown[] = []

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: (command: string) =>
    command === 'read_note' ? Promise.resolve('{"nodes":[],"edges":[]}') : Promise.resolve(null),
}))

vi.stubGlobal(
  'IntersectionObserver',
  function seen(told: (entries: { isIntersecting: boolean }[]) => void) {
    return {
      observe: () => queueMicrotask(() => told([{ isIntersecting: true }])),
      disconnect: () => undefined,
    }
  },
)

providePort('canvas.pictures', {
  svg: (plane) => {
    asked.push(plane)
    return Promise.resolve('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
  },
})

const { drawFile } = await import('./drawn')

test('a canvas set into a note is drawn by whoever draws planes, from the note it reads', async () => {
  const card = document.body.appendChild(document.createElement('div'))
  card.innerHTML = '<a href="Board.canvas">Board</a>'
  drawFile(card, { kind: 'canvas', path: 'Board.canvas', root: '/space', page: null })

  await vi.waitFor(() => {
    expect(card.querySelector('svg rect')).not.toBeNull()
  })
  expect(asked).toEqual([
    {
      text: '{"nodes":[],"edges":[]}',
      name: 'Board.canvas',
      path: 'Board.canvas',
      root: '/space',
      note: '/space/Board.canvas',
    },
  ])
})
