import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

class NoLayout {
  observe() {
    // Nothing ever moves in jsdom, so nothing is ever reported.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const WebTab = (await import('../../src/lib/web-tab/WebTab.svelte')).default

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  target.remove()
  vi.useRealTimers()
})

test('a pane draws the bar for a website nothing has asked about before', () => {
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  expect(tab?.kind).toBe('web')
  if (!tab) return

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  expect(() => flushSync()).not.toThrow()

  expect(target.querySelector('.web')).not.toBeNull()
  expect(target.querySelector('input')).not.toBeNull()

  expect(pages.of(tab.id)).toBe(pages.of(tab.id))

  void unmount(app)
  workspace.close(tab.id)
})

test('the bar can report typing after its own pane has gone', () => {
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')

  const said: string[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...words) => {
    said.push(words.map((one) => String(one)).join(' '))
  })

  try {
    const app = mount(WebTab, { target, props: { tab, focused: true } })
    flushSync()

    const field = target.querySelector('input')
    if (!field) throw new Error('no address field')

    field.focus()
    flushSync()
    expect(pages.of(tab.id).typing).toBe(true)

    void unmount(app)
    flushSync()

    expect(pages.of(tab.id).typing).toBe(false)
    expect(said.filter((one) => one.includes('derived_inert'))).toEqual([])
  } finally {
    warn.mockRestore()
    workspace.close(tab.id)
  }
})

test.each([
  ['closed, so there is no tab', () => null],
  ['swapped, so there is another', () => workspace.tabs.at(-2) ?? null],
])('the bar reports typing to its own tab after the pane’s tab was %s', (_, next) => {
  workspace.openWebsite()
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  const other = workspace.tabs.at(-2)
  if (!tab || !other) throw new Error('no tabs')

  let current: typeof tab | null = tab
  const app = mount(WebTab, {
    target,
    props: {
      get tab() {
        return current!
      },
      focused: true,
    },
  })

  try {
    flushSync()
    const field = target.querySelector('input')
    if (!field) throw new Error('no address field')

    field.focus()
    flushSync()
    expect(pages.of(tab.id).typing).toBe(true)

    pages.of(other.id).typing = true
    current = next()
    field.blur()

    expect(pages.of(tab.id).typing).toBe(false)
    expect(pages.of(other.id).typing).toBe(true)
  } finally {
    current = tab
    void unmount(app)
    pages.of(other.id).typing = false
    workspace.close(tab.id)
    workspace.close(other.id)
  }
})

test('a web tab closed before its pane lets go leaves no page behind', () => {
  workspace.openWebsite()
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')

  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()

  workspace.close(tab.id)
  void unmount(app)
  flushSync()

  expect(pages.each().map(([id]) => id)).not.toContain(tab.id)
})
