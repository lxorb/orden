// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { overlayScrollbar } from './scrollbar'

const GEOMETRY: Record<string, number> = {
  clientHeight: 400,
  clientWidth: 300,
  scrollHeight: 1600,
  scrollTop: 0,
  offsetTop: 0,
  offsetLeft: 0,
}
let log: string[] = []
let frames: FrameRequestCallback[] = []
const flush = () => {
  const now = frames
  frames = []
  for (const run of now) run(0)
}
const read = (name: string) => () => {
  log.push(`read ${name}`)
  return GEOMETRY[name] ?? 0
}
beforeEach(() => {
  log = []
  frames = []
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = () => undefined
      disconnect = () => undefined
    },
  )
  for (const name of Object.keys(GEOMETRY)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: read(name), set: () => undefined })
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
    log.push('read box')
    return new DOMRect()
  })
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
    log.push('read style')
    return computed(node)
  })
  vi.spyOn(DOMTokenList.prototype, 'toggle').mockImplementation(function (this: DOMTokenList, token, force) {
    log.push(`write ${token}`)
    const on = force ?? !this.contains(token)
    if (on) this.add(token)
    else this.remove(token)
    return on
  })
})
afterEach(() => {
  flush()
  for (const name of Object.keys(GEOMETRY)) Reflect.deleteProperty(HTMLElement.prototype, name)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
function scroller() {
  const host = document.createElement('div')
  const list = document.createElement('div')
  host.append(list)
  document.body.append(host)
  return { host, list }
}
describe('the overlay scrollbar, asked to draw (#2290)', () => {
  test('reads no layout while it is asked: not when made, settled or scrolled', () => {
    const { host, list } = scroller()
    const bar = overlayScrollbar(list, host)
    bar.settle()
    list.dispatchEvent(new Event('scroll'))
    list.dispatchEvent(new Event('pointerenter'))
    expect(log).toEqual([])
    flush()
    expect(log.some((one) => one.startsWith('read'))).toBe(true)
    bar.stop()
  })
  test('draws every bar asked in one frame, all of them read before any is written', () => {
    const bars = [scroller(), scroller(), scroller()].map(({ host, list }) => overlayScrollbar(list, host))
    flush()
    const firstWrite = log.findIndex((one) => one.startsWith('write'))
    const lastRead = log.reduce((last, one, at) => (one.startsWith('read') ? at : last), -1)
    expect(firstWrite).toBeGreaterThan(-1)
    expect(lastRead).toBeLessThan(firstWrite)
    expect(log.filter((one) => one === 'write is-needed')).toHaveLength(3)
    expect(frames).toEqual([])
    for (const one of bars) one.stop()
  })
  test('writes nothing again when nothing moved, and asks no frame once stopped', () => {
    const { host, list } = scroller()
    const bar = overlayScrollbar(list, host)
    flush()
    log = []
    bar.settle()
    flush()
    expect(log.filter((one) => one.startsWith('write'))).toEqual([])
    bar.stop()
    log = []
    flush()
    bar.settle()
    flush()
    expect(log.filter((one) => one.startsWith('read') && one !== 'read box' && one !== 'read style')).toEqual([])
  })
})
