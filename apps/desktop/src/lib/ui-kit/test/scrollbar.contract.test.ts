// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { surfaceScrollbar } from '../src/api'

let frames: FrameRequestCallback[] = []
const flush = () => {
  for (let round = 0; round < 3 && frames.length; round++) {
    const now = frames
    frames = []
    for (const run of now) run(0)
  }
}
beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})
afterEach(() => {
  flush()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
function surfaced() {
  const page = { content: 1600, visible: 400, at: 0, asked: [] as number[] }
  const host = document.createElement('div')
  document.body.append(host)
  const bar = surfaceScrollbar(host, {
    content: () => page.content,
    visible: () => page.visible,
    at: () => page.at,
    to: (at) => void page.asked.push(at),
  })
  flush()
  const thumb = host.querySelector<HTMLElement>('.orden-scrollbar-thumb')
  return { page, host, bar, thumb }
}
describe('a scrollbar over a surface that scrolls itself (#2447)', () => {
  test('sizes and places its thumb from what the surface says, in screen pixels', () => {
    const { page, host, bar, thumb } = surfaced()
    expect(host.querySelector('.orden-scrollbar')?.classList.contains('is-needed')).toBe(true)
    expect(thumb?.style.height).toBe('100px')
    expect(thumb?.style.transform).toBe('translateY(0px)')
    page.at = 600
    bar.moved()
    flush()
    expect(thumb?.style.transform).toBe('translateY(150px)')
    expect(host.querySelector('.orden-scrollbar')?.classList.contains('is-lit')).toBe(true)
    page.content = 400
    bar.moved()
    flush()
    expect(host.querySelector('.orden-scrollbar')?.classList.contains('is-needed')).toBe(false)
    bar.stop()
    expect(host.querySelector('.orden-scrollbar')).toBeNull()
  })
  test('asks the surface to scroll by the dragged distance scaled to its content', () => {
    const { page, thumb } = surfaced()
    page.at = 200
    Object.assign(thumb ?? {}, { setPointerCapture: () => undefined })
    const at = (type: string, clientY: number) =>
      thumb?.dispatchEvent(Object.assign(new MouseEvent(type, { clientY, bubbles: true }), { pointerId: 1 }))
    at('pointerdown', 50)
    at('pointermove', 80)
    at('pointermove', 20)
    at('pointerup', 20)
    at('pointermove', 90)
    expect(page.asked).toEqual([200 + 30 * 4, 200 - 30 * 4])
  })
})
