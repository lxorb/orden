import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { world } from './reading-embed-world.svelte'

vi.mock('../../src/lib/reading/src/drawn', () => ({ inlineFiles: () => () => undefined }))
vi.mock('../../src/lib/reading/src/render', () => ({
  readingHtml: async (source: { text: string }) => {
    await Promise.resolve()
    return source.text
      .split('\n')
      .filter(Boolean)
      .map((line) => `<p>${line.includes('[[Plan]]') ? world.embedded : line}</p>`)
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
vi.mock('../../src/lib/workspace/src/api', () => ({
  workspace: {
    rootHolding: () => null,
    notePlace: () => undefined,
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
})

async function opened(doc: string) {
  world.doc = doc
  const tab = {
    id: 't1',
    path: '/s/Today.md',
    shown: 'Today',
    anchor: undefined,
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
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(Reading, { target, props: { tab: tab as never, focused: true } })
  flushSync()
  await wait(50)
  await frames()
  flushSync()
  return target
}

function scrolledTo(box: HTMLElement, at: number) {
  let top = at
  Object.defineProperty(box, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value
    },
  })
}

test('another note saved in the space leaves a long note with a picture where it was read', async () => {
  const words = Array.from({ length: 200 }, (_, at) => `Line ${String(at)} of the trip.`).join(
    '\n\n',
  )
  const target = await opened(`${words}\n\n![[beach.png]]\n\n${words}`)
  const box = target.querySelector<HTMLElement>('.scroller')
  if (!box) throw new Error('no scroller')
  scrolledTo(box, 2400)

  world.version++
  flushSync()
  await wait(400)
  flushSync()

  expect(box.scrollTop).toBe(2400)
})

test('links drawn before the space index arrived are drawn again once it does', async () => {
  world.embedded = 'See Plan'
  const target = await opened('Trip\n\nSee [[Plan]]')
  expect(target.querySelector('article')?.textContent).toBe('TripSee Plan')

  world.embedded = 'See linked Plan'
  world.version++
  flushSync()
  await wait(400)
  flushSync()

  expect(target.querySelector('article')?.textContent).toBe('TripSee linked Plan')
})
