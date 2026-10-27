import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { note } from './reading-find-redraw-world.svelte'

/** The reading view's find bar, after the page is drawn again under it.
 *
 *  a26-desktop4 D4-2: a page drawn again while the bar was open - the note typed into
 *  in another pane, a sync edit, the theme changed - was counted as the page before
 *  it. The bar comes before the page in the markup, so its tally asked for the words
 *  in the flush that put the new page in, read the old page and kept what it read
 *  until the next redraw: `1 of 1` over a page with three, through a new query and
 *  through closing and opening the bar again. The renderer is a line per paragraph
 *  here; nothing about the find depends on what the page looks like. */

vi.mock('../../src/lib/reading/render', () => ({
  readingHtml: async (source: { text: string }) =>
    source.text
      .split('\n')
      .map((line) => `<p>${line}</p>`)
      .join(''),
  unreadableHtml: (text: string) => text,
  tagAnchor: (tag: string) => `#${tag}`,
}))
vi.mock('../../src/lib/reading/drawn', () => ({ inlineFiles: () => () => undefined }))
// A base drawn as its view, in place of the fence the renderer left.
vi.mock('../../src/lib/views/mount', () => ({
  mountBases: (page: HTMLElement) => {
    for (const host of page.querySelectorAll('[data-base-code]')) host.replaceChildren('view')
    return () => undefined
  },
}))
vi.mock('../../src/lib/scrollbar', () => ({ scrollbar: () => ({ destroy: () => undefined }) }))
vi.mock('../../src/lib/sharing.svelte', () => ({ trustsHtmlIn: () => false }))
vi.mock('../../src/lib/link-index.svelte', () => ({ links: { version: 0, index: () => null } }))
vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: {
    rootHolding: () => null,
    notePlace: () => undefined,
    toggleReading: () => undefined,
  },
}))
vi.mock('../../src/lib/shortcuts.svelte', () => ({
  shortcuts: {
    pressed: (id: string, event: KeyboardEvent) => id === 'edit.find' && event.key === 'f',
    tooltip: (label: string) => label,
    hint: () => '',
  },
}))

// jsdom has no Web Animations. Svelte's transitions wait for `onfinish`, so the bar
// would never leave.
Element.prototype.animate = function () {
  return {
    finished: Promise.resolve(),
    cancel: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    set onfinish(done: () => void) {
      setTimeout(done, 0)
    },
  } as never
}
Range.prototype.getBoundingClientRect = () => new DOMRect()

const Reading = (await import('../../src/lib/Reading.svelte')).default

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
  note.doc = 'alpha beta'
  note.revision = 0
})

async function opened() {
  const tab = {
    id: 't1',
    path: '/s/A.md',
    shown: 'A',
    anchor: undefined,
    get doc() {
      return note.doc
    },
    note: {
      get revision() {
        return note.revision
      },
      flush: () => undefined,
    },
  }
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(Reading, { target, props: { tab: tab as never, focused: true } })
  flushSync()
  await wait(50)
  flushSync()
  expect(target.querySelector('article')?.textContent).toBe('alpha beta')
  return target
}

function find(target: HTMLElement, what: string) {
  const input = target.querySelector('input')!
  input.value = what
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function openBar(target: HTMLElement) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
  flushSync()
  return target.querySelector('input')!
}

const tally = (target: HTMLElement) => target.querySelector('.tally')?.textContent

async function redrawn(target: HTMLElement, doc: string, shows = doc.replaceAll('\n', '')) {
  note.doc = doc
  note.revision++
  flushSync()
  await wait(400)
  flushSync()
  expect(target.querySelector('article')?.textContent).toBe(shows)
}

test('the tally counts the page that is showing after a redraw', async () => {
  const target = await opened()
  openBar(target)
  find(target, 'beta')
  await wait(50)
  expect(tally(target)).toBe('1 of 1')

  await redrawn(target, 'beta beta beta')
  expect(tally(target)).toBe('1 of 3')

  find(target, 'bet')
  expect(tally(target)).toBe('1 of 3')
})

test('a bar opened again after a redraw it was open for searches the new page', async () => {
  const target = await opened()
  openBar(target)
  find(target, 'beta')
  await wait(50)
  expect(tally(target)).toBe('1 of 1')
  await redrawn(target, 'beta\nbeta')

  target
    .querySelector('input')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  await wait(50)
  flushSync()
  expect(target.querySelector('input')).toBeNull()

  openBar(target)
  find(target, 'beta')
  expect(tally(target)).toBe('1 of 2')
})

test('a base drawn after the page is not counted by the fence it replaced', async () => {
  const target = await opened()
  openBar(target)
  find(target, 'beta')
  await wait(50)
  expect(tally(target)).toBe('1 of 1')

  await redrawn(target, 'beta\n<div data-base-code="beta">beta</div>', 'betaview')
  expect(tally(target)).toBe('1 of 1')
})
