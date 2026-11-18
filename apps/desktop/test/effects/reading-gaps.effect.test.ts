import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { world } from './reading-embed-world.svelte'

const ROW = 24

const WORDS = 18

vi.mock('../../src/lib/reading/src/drawn', () => ({ inlineFiles: () => () => undefined }))
vi.mock('../../src/lib/reading/src/render', () => ({
  readingHtml: async (source: { text: string }) => {
    await Promise.resolve()
    return source.text
      .split('\n')
      .filter(Boolean)
      .map((line) =>
        line.startsWith('# ')
          ? `<h1 id="${line.slice(2).toLowerCase()}">${line.slice(2)}</h1>`
          : `<p>${line}</p>`,
      )
      .join('')
  },
  unreadableHtml: (text: string) => text,
  tagAnchor: (tag: string) => `#${tag}`,
}))
vi.mock('../../src/lib/ui-kit/src/scrollbar', () => ({
  scrollbar: () => ({ destroy: () => undefined }),
}))
vi.mock('../../src/lib/sharing/src/api', () => ({ trustsHtmlIn: () => false }))
vi.mock('../../src/lib/link-index/src/api', () => ({
  links: {
    get version() {
      return world.version
    },
    index: () => null,
    locksSeen: () => '',
  },
}))

const tab = {
  id: 't1',
  path: '/s/Trip.md',
  shown: 'Trip',
  anchor: undefined as number | undefined,
  get doc() {
    return world.doc
  },
  note: {
    get revision() {
      return world.revision
    },
    flush: () => undefined,
  },
}

vi.mock('../../src/lib/workspace/src/api', () => ({
  workspace: {
    rootHolding: () => null,
    notePlace: (_id: string, _scroll: number, anchor: number) => {
      tab.anchor = anchor
    },
    toggleReading: () => undefined,
  },
}))

const Reading = (await import('../../src/lib/reading/src/Reading.svelte')).default

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const frames = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
  world.version = 0
  world.embedded = 'first words'
  world.doc = 'Today\n\n![[Flow]]'
  tab.anchor = undefined
  top = 0
})

let top = 0

const rowOf = (element: Element) =>
  element.parentElement ? [...element.parentElement.children].indexOf(element) : 0

Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
  configurable: true,
  value(this: Element) {
    if (this.classList.contains('scroller')) return new DOMRect(0, 0, 800, 600)
    return new DOMRect(0, rowOf(this) * ROW - top, 800, ROW)
  },
})
Element.prototype.scrollIntoView = function (this: Element) {
  top = rowOf(this) * ROW
}

const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
Object.defineProperty(Element.prototype, 'scrollTop', {
  configurable: true,
  get(this: Element) {
    return this.classList.contains('scroller') ? top : Number(scrollTop?.get?.call(this) ?? 0)
  },
  set(this: Element, value: number) {
    if (this.classList.contains('scroller')) top = value
  },
})
Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 600 })
Object.defineProperty(Element.prototype, 'scrollHeight', {
  configurable: true,
  get: () => 100000,
})

function laidOut(box: HTMLElement) {
  const page = box.querySelector('article')
  if (!page) throw new Error('no page')
  document.elementFromPoint = (_x: number, y: number) =>
    (y + top) % ROW < WORDS ? (page.children[Math.floor((y + top) / ROW)] ?? null) : page
  return {
    scrollTo(at: number) {
      top = at
      box.dispatchEvent(new Event('scroll'))
    },
    get top() {
      return top
    },
  }
}

async function opened(doc: string) {
  world.doc = doc
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(Reading, { target, props: { tab: tab as never, focused: true } })
  flushSync()
  await wait(50)
  await frames()
  flushSync()
  const box = target.querySelector<HTMLElement>('.scroller')
  if (!box) throw new Error('no scroller')
  return laidOut(box)
}

async function anotherNoteSaved() {
  world.version++
  flushSync()
  await wait(400)
  flushSync()
}

const lines = (count: number) =>
  Array.from({ length: count }, (_, at) => `Day ${String(at)} of the trip, see [[Plan]].`).join(
    '\n\n',
  )

test('a reader who stops where the top edge falls between two paragraphs stays there when another note is saved', async () => {
  const layout = await opened(`# Trip\n\n${lines(300)}\n\n# Home\n\nEnd.`)
  layout.scrollTo(4800 + 20)
  await wait(50)

  await anotherNoteSaved()

  expect(Math.abs(layout.top - 4820)).toBeLessThan(ROW)
})

test('leaving the reading view where the top edge falls between two paragraphs hands the editor that place, not the top', async () => {
  const doc = `# Trip\n\n${lines(300)}\n\n# Home\n\nEnd.`
  const layout = await opened(doc)
  layout.scrollTo(4800 + 20)
  await wait(50)

  expect(tab.anchor ?? 0).toBeGreaterThan(doc.indexOf('Day 150 '))
})
