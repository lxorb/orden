import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const showing = new Map<string, { id: string }>()
vi.mock('../../platform/src/tauri', () => ({ isDesktop: false, isMobile: false }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    tabs: [],
    showing: (pane: string) => showing.get(pane),
    goBack: () => undefined,
    goForward: () => undefined,
  },
}))
const { heard, listen, touchpad, HOLD, MOMENT, PLAYS, WATCH } = await import('./swipes')
const { QUIET } = await import('./gesture')
const { swiping } = await import('./shown.svelte')
type Tab = import('../../workspace/src/api').Tab
type Source = import('./gesture').Source
const pane = document.createElement('div')
pane.dataset.pane = 'p'
document.body.append(pane)
pane.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 40, width: 800, height: 560 })
const tab = { id: 't', kind: 'note', paneId: 'p', canGoBack: true, canGoForward: true } as Tab
const NONE = { left: false, right: false }
let stop: () => void = () => undefined
let at = 0
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  })
  showing.set('p', { id: 't' })
  stop = listen()
})
afterEach(() => {
  stop()
  vi.useRealTimers()
})
function swipe(source: Source = 'touch') {
  for (let step = 0; step < 6; step++) {
    at += 8
    vi.advanceTimersByTime(8)
    heard({ tab, source, dx: 12, dy: 0, at, scrolls: NONE })
  }
  flushSync()
  expect(swiping.tab).toBe('t')
  expect(swiping.stage).toBe('tracking')
}
function out(): boolean {
  flushSync()
  return swiping.tab !== null
}
function loseTimers(waited: number) {
  const lost = performance.now()
  vi.clearAllTimers()
  vi.advanceTimersByTime(lost + waited)
}
function playsOut() {
  vi.advanceTimersByTime(PLAYS + 1)
  expect(out()).toBe(false)
}
describe('a swipe always ends, and its arrow goes', () => {
  test('when the fingers lift', () => {
    swipe()
    window.dispatchEvent(new Event('touchend'))
    playsOut()
  })
  test('when the gesture is cancelled', () => {
    swipe()
    window.dispatchEvent(new Event('touchcancel'))
    playsOut()
  })
  test('when a touchpad stream stops without a final event', () => {
    swipe('touchpad')
    vi.advanceTimersByTime(QUIET)
    playsOut()
  })
  test('when the touchpad says the fingers lifted, or a third one came down', () => {
    touchpad(2)
    swipe('touchpad')
    touchpad(0)
    playsOut()
    touchpad(2)
    swipe('touchpad')
    touchpad(3)
    playsOut()
  })
  test('when the window loses focus', () => {
    swipe()
    window.dispatchEvent(new Event('blur'))
    playsOut()
  })
  test('when the page is hidden', () => {
    swipe()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockRestore()
    playsOut()
  })
  test('when the pane switches to another tab mid-swipe', () => {
    swipe()
    showing.set('p', { id: 'terminal' })
    vi.advanceTimersByTime(WATCH)
    expect(out()).toBe(false)
  })
  test('when the tab closes or its pane is hidden', () => {
    swipe()
    showing.delete('p')
    vi.advanceTimersByTime(WATCH)
    expect(out()).toBe(false)
  })
  test('when the end event is swallowed and nothing more comes', () => {
    swipe()
    vi.advanceTimersByTime(HOLD)
    playsOut()
  })
  test('when its timers are lost, at the next stir of the pointer', () => {
    swipe()
    loseTimers(HOLD + MOMENT + 1)
    expect(out()).toBe(true)
    window.dispatchEvent(new Event('pointermove'))
    playsOut()
  })
  test('and an arrow left out after its swipe ended goes within a moment', () => {
    swipe()
    window.dispatchEvent(new Event('touchend'))
    loseTimers(PLAYS + MOMENT)
    window.dispatchEvent(new Event('keydown'))
    expect(out()).toBe(false)
  })
})
