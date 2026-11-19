import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
const { default: Cells } = await import('./Cells.svelte')
let now = 0
let waiting = new Map<number, FrameRequestCallback>()
let next = 1
function frame() {
  now += 1000 / 60
  const due = waiting
  waiting = new Map()
  for (const run of due.values()) run(now)
  flushSync()
}
beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((run) => {
    waiting.set(next, run)
    return next++
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void waiting.delete(id))
})
afterEach(() => {
  vi.restoreAllMocks()
  waiting = new Map()
})
test('the bubbles ask for no frame once their windows stand still, and for frames again when woken', () => {
  const box = { x: 0, y: 0, w: 400, h: 300 }
  const target = document.createElement('div')
  document.body.append(target)
  const cells = [{ key: 'a', name: 'A', tint: null, on: true }]
  const made = mount(Cells, {
    target,
    props: { cells, inside: () => [box], pushed: () => null, holding: false },
  }) as unknown as { wake: () => void }
  flushSync()
  expect(waiting.size).toBe(1)
  let frames = 0
  while (waiting.size && frames < 600) {
    frame()
    frames++
  }
  expect(frames).toBeLessThan(600)
  const path = target.querySelector('path')?.getAttribute('d')
  for (let i = 0; i < 30; i++) frame()
  expect(waiting.size).toBe(0)
  box.x = 200
  made.wake()
  expect(waiting.size).toBe(1)
  frame()
  expect(target.querySelector('path')?.getAttribute('d')).not.toBe(path)
  frames = 0
  while (waiting.size && frames < 600) {
    frame()
    frames++
  }
  expect(frames).toBeLessThan(600)
  void unmount(made)
  target.remove()
})
