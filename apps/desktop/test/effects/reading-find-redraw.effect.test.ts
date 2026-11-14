import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { note } from './reading-find-redraw-world.svelte'

vi.mock('../../src/lib/reading/src/api', async () => ({
  ...(await import('../../src/lib/reading/src/find')),
  ...(await import('../../src/lib/reading/src/places')),
  inlineFiles: () => () => undefined,
  readingHtml: async (source: { text: string }) =>
    source.text
      .split('\n')
      .map((line) => `<p>${line}</p>`)
      .join(''),
  unreadableHtml: (text: string) => text,
  tagAnchor: (tag: string) => `#${tag}`,
}))
vi.mock('../../src/lib/views/mount', () => ({
  mountBases: (page: HTMLElement) => {
    for (const host of page.querySelectorAll('[data-base-code]')) host.replaceChildren('view')
    return () => undefined
  },
}))
vi.mock('../../src/lib/ui-kit/src/scrollbar', () => ({
  scrollbar: () => ({ destroy: () => undefined }),
}))
vi.mock('../../src/lib/sharing/src/api', () => ({ trustsHtmlIn: () => false }))
vi.mock('../../src/lib/link-index.svelte', () => ({
  links: { version: 0, index: () => null, locksSeen: () => '' },
}))
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

test('Find pressed in a dialog over the page, or already taken, opens no bar behind it', async () => {
  const target = await opened()
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const field = document.createElement('input')
  dialog.append(field)
  document.body.append(dialog)

  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
  const taken = new KeyboardEvent('keydown', { key: 'f', cancelable: true })
  taken.preventDefault()
  window.dispatchEvent(taken)
  flushSync()
  expect(target.querySelector('input')).toBeNull()

  expect(openBar(target)).not.toBeNull()
})
