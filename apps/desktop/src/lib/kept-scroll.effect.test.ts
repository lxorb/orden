import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  forgetKeptScrolls,
  holdScroll,
  keepsScroll,
  keptScroll,
  SCROLL_KEPT,
  scrollKeyOf,
} from './kept-scroll'
import type { TabKind } from './workspace/tab-kinds'

const frames = async (count = 3) => {
  for (let one = 0; one < count; one += 1) {
    await new Promise((done) => requestAnimationFrame(() => done(null)))
  }
}

function scrolling(element: HTMLElement, height = 5000) {
  let top = 0
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => 400 })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (to: number) => (top = Math.max(0, Math.min(to, height - 400))),
  })
  return element
}

function drawn(kind: string): { root: HTMLElement; scroller: HTMLElement; inner: HTMLElement } {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'pane'
  root.innerHTML = `<div class="head"></div><section class="${kind}"><nav class="side"></nav><div class="body"><div class="list"></div></div></section>`
  const scroller = scrolling(root.querySelector<HTMLElement>('.body')!)
  const inner = scrolling(root.querySelector<HTMLElement>('.side')!)
  return { root, scroller, inner }
}

function scrollTo(element: HTMLElement, top: number) {
  element.scrollTop = top
  element.dispatchEvent(new Event('scroll'))
}

beforeEach(() => {
  localStorage.clear()
  forgetKeptScrolls()
})

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

test.each([...SCROLL_KEPT])(
  'a %s tab switched away from and back keeps its scroll',
  async (kind) => {
    const key = scrollKeyOf({ kind, path: `/space/${kind}`, reading: false }, 0)
    expect(key).not.toBeNull()

    const first = drawn(kind)
    const keeping = keepsScroll(first.root, key)
    scrollTo(first.scroller, 1234)
    scrollTo(first.inner, 77)
    keeping.destroy()
    first.root.remove()

    const back = drawn(kind)
    const again = keepsScroll(back.root, key)
    await frames()
    expect(back.scroller.scrollTop).toBe(1234)
    expect(back.inner.scrollTop).toBe(77)
    again.destroy()
  },
)

test('switching tabs in one pane hands each tab its own scroll', async () => {
  const { root, scroller } = drawn('pass')
  const keeping = keepsScroll(root, '0:pass:')
  scrollTo(scroller, 900)

  keeping.update('0:settings:')
  root.querySelector('section')!.replaceWith(drawn('settings').root.querySelector('section')!)
  await frames()
  const settings = scrolling(root.querySelector<HTMLElement>('.body')!)
  expect(settings.scrollTop).toBe(0)
  scrollTo(settings, 300)

  keeping.update('0:pass:')
  root.querySelector('section')!.replaceWith(drawn('pass').root.querySelector('section')!)
  const pass = scrolling(root.querySelector<HTMLElement>('.body')!)
  await frames()
  expect(pass.scrollTop).toBe(900)
  keeping.destroy()
})

test('each Settings page keeps its own scroll as the pages change under one scroller', async () => {
  const { root, scroller } = drawn('settings')
  scroller.dataset.scrollKey = 'general'
  const keeping = keepsScroll(root, '0:settings:')
  await frames()
  scrollTo(scroller, 600)

  scroller.dataset.scrollKey = 'appearance'
  scroller.scrollTop = 0
  await frames()
  expect(scroller.scrollTop).toBe(0)
  scrollTo(scroller, 250)

  scroller.dataset.scrollKey = 'general'
  scroller.scrollTop = 0
  await frames()
  expect(scroller.scrollTop).toBe(600)

  scroller.dataset.scrollKey = 'appearance'
  await frames()
  expect(scroller.scrollTop).toBe(250)
  keeping.destroy()
})

test('two windows keep their own scroll for the same tab', async () => {
  const kind: TabKind = 'settings'
  const one = scrollKeyOf({ kind, path: null, reading: false }, 0)
  const other = scrollKeyOf({ kind, path: null, reading: false }, 1)
  expect(one).not.toBe(other)

  const a = drawn(kind)
  const keeping = keepsScroll(a.root, one)
  scrollTo(a.scroller, 500)
  keeping.destroy()

  const b = drawn(kind)
  const there = keepsScroll(b.root, other)
  await frames()
  expect(b.scroller.scrollTop).toBe(0)
  there.destroy()
})

test('a scroll is kept across a restart', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const first = drawn('time')
  const keeping = keepsScroll(first.root, '0:time:')
  scrollTo(first.scroller, 1500)
  keeping.destroy()
  vi.runAllTimers()
  vi.useRealTimers()

  forgetKeptScrolls()
  expect(keptScroll('0:time:|section.time:0/div.body:0')).toBe(1500)

  const after = drawn('time')
  const again = keepsScroll(after.root, '0:time:')
  await frames()
  expect(after.scroller.scrollTop).toBe(1500)
  again.destroy()
})

test('a deep link that scrolls to a setting is not undone by the kept scroll', async () => {
  const first = drawn('settings')
  first.scroller.dataset.scrollKey = 'general'
  const keeping = keepsScroll(first.root, '0:settings:')
  await frames()
  scrollTo(first.scroller, 2000)
  keeping.destroy()

  const back = drawn('settings')
  back.scroller.dataset.scrollKey = 'general'
  holdScroll(back.scroller)
  back.scroller.scrollTop = 140
  const again = keepsScroll(back.root, '0:settings:')
  await frames()
  expect(back.scroller.scrollTop).toBe(140)
  again.destroy()
})

test('a scroller that keeps its own place, a note or a reading view is left alone', async () => {
  expect(scrollKeyOf({ kind: 'note', path: '/a.md', reading: false }, 0)).toBeNull()
  expect(scrollKeyOf({ kind: 'settings', path: null, reading: true }, 0)).toBeNull()
  expect(scrollKeyOf({ kind: 'web', path: null, reading: false }, 0)).toBeNull()

  const first = drawn('channel')
  first.scroller.dataset.ownScroll = ''
  const keeping = keepsScroll(first.root, '0:channel:')
  scrollTo(first.scroller, 800)
  keeping.destroy()

  const back = drawn('channel')
  back.scroller.dataset.ownScroll = ''
  const again = keepsScroll(back.root, '0:channel:')
  await frames()
  expect(back.scroller.scrollTop).toBe(0)
  again.destroy()
})

test('content that arrives late is scrolled once it is tall enough, and a hand on it stops that', async () => {
  const first = drawn('explorer')
  const keeping = keepsScroll(first.root, '0:explorer:')
  scrollTo(first.scroller, 3000)
  keeping.destroy()

  const back = drawn('explorer')
  const short = scrolling(back.scroller, 1000)
  const again = keepsScroll(back.root, '0:explorer:')
  await frames()
  expect(short.scrollTop).toBe(600)
  scrolling(back.scroller, 6000)
  await frames()
  expect(back.scroller.scrollTop).toBe(3000)
  again.destroy()

  const third = drawn('explorer')
  scrolling(third.scroller, 1000)
  const later = keepsScroll(third.root, '0:explorer:')
  await frames()
  third.root.dispatchEvent(new Event('wheel'))
  scrolling(third.scroller, 6000)
  await frames()
  expect(third.scroller.scrollTop).toBe(0)
  later.destroy()
})
