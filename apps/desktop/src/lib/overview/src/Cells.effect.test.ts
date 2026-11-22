import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const motion = { matches: false, media: '', addEventListener: () => undefined, removeEventListener: () => undefined }
window.matchMedia = (() => motion) as unknown as typeof window.matchMedia
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
test('each bubble wobbles on its own, endlessly, with no frame asked of the page, holds still while the hand moves, and stands still when asked for no movement', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const swayed: { node: Element; frames: Keyframe[]; iterations: number; playing: boolean }[] = []
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      const one = { node: this, frames, iterations: Number(options.iterations), playing: true }
      swayed.push(one)
      return {
        cancel: () => undefined,
        pause: () => {
          one.playing = false
        },
        play: () => {
          one.playing = true
        },
        currentTime: 0,
      } as unknown as Animation
    },
  })
  const target = document.createElement('div')
  document.body.append(target)
  const cells = [
    { key: 'a', name: 'A', tint: null, on: true },
    { key: 'b', name: 'B', tint: null, on: false },
  ]
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    a: { x: 0, y: 0, w: 400, h: 300 },
    b: { x: 520, y: 0, w: 400, h: 300 },
  }
  try {
    const made = mount(Cells, {
      target,
      props: {
        cells,
        inside: (key: string) => [boxes[key] ?? { x: 0, y: 0, w: 1, h: 1 }],
        pushed: () => null,
        holding: false,
      },
    })
    flushSync()
    for (let i = 0; i < 30 && waiting.size; i++) frame()
    expect(waiting.size).toBe(0)
    expect(swayed).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    const holders = [...target.querySelectorAll('svg.cells')]
    expect(holders).toHaveLength(2)
    expect(swayed.map((one) => holders.indexOf(one.node))).toStrictEqual([0, 1])
    for (const one of swayed) {
      expect(one.iterations).toBe(Number.POSITIVE_INFINITY)
      expect(new Set(one.frames.map((at) => at.transform)).size).toBeGreaterThan(10)
    }
    expect(swayed[0]?.frames[3]?.transform).not.toBe(swayed[1]?.frames[3]?.transform)
    expect((holders[0] as SVGSVGElement).style.transformOrigin).toMatch(/^\d+px \d+px$/)
    expect(swayed.map((one) => one.playing)).toStrictEqual([true, true])
    window.dispatchEvent(new PointerEvent('pointermove'))
    expect(swayed.map((one) => one.playing)).toStrictEqual([false, false])
    vi.advanceTimersByTime(1000)
    expect(swayed.map((one) => one.playing)).toStrictEqual([true, true])
    void unmount(made)
    swayed.length = 0
    motion.matches = true
    const still = mount(Cells, {
      target,
      props: {
        cells,
        inside: (key: string) => [boxes[key] ?? { x: 0, y: 0, w: 1, h: 1 }],
        pushed: () => null,
        holding: false,
      },
    })
    flushSync()
    for (let i = 0; i < 30 && waiting.size; i++) frame()
    vi.advanceTimersByTime(1000)
    expect(swayed).toHaveLength(0)
    void unmount(still)
  } finally {
    vi.useRealTimers()
    motion.matches = false
    delete (Element.prototype as { animate?: unknown }).animate
    target.remove()
  }
})
