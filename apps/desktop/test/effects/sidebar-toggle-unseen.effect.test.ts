import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'

const SidebarToggle = (await import('../../src/lib/SidebarToggle.svelte')).default
const { workspace } = await import('../../src/lib/workspace.svelte')

let shown: ReturnType<typeof mount>
let toggle: HTMLButtonElement

beforeEach(() => {
  workspace.closePanel()
  shown = mount(SidebarToggle, { target: document.body, props: { unseen: true } })
  flushSync()
  toggle = document.querySelector<HTMLButtonElement>('[data-side-toggle]')!
})

afterEach(() => {
  void unmount(shown)
  document.body.replaceChildren()
  workspace.closePanel()
})

test('is said and not shown, named for a screen reader, and still opens the list', () => {
  expect(toggle.classList.contains('nib-said')).toBe(true)
  expect(toggle.getAttribute('aria-label')).toBe('Show left sidebar')
  expect(toggle.tabIndex).toBe(0)
  toggle.click()
  flushSync()
  expect(workspace.openOn('left')).toBeTruthy()
})

test('is seen while the keyboard is on it, and said again once it leaves', () => {
  toggle.matches = (selector: string) => selector === ':focus-visible'
  toggle.focus()
  flushSync()
  expect(toggle.classList.contains('nib-said')).toBe(false)
  toggle.blur()
  flushSync()
  expect(toggle.classList.contains('nib-said')).toBe(true)
})

test('the drawer head and the bar on a phone both say it and do not show it', async () => {
  Element.prototype.scrollIntoView = () => undefined
  globalThis.ResizeObserver = class {
    observe() {
      // Nothing to measure.
    }

    unobserve() {
      // Nothing to measure.
    }

    disconnect() {
      // Nothing to measure.
    }
  }
  const { viewport } = await import('../../src/lib/viewport.svelte')
  const { fullscreen } = await import('../../src/lib/fullscreen.svelte')
  const { default: Sidebar } = await import('../../src/lib/Sidebar.svelte')
  const { default: Titlebar } = await import('../../src/lib/Titlebar.svelte')
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  workspace.activeSpaceId = 'work'
  workspace.tabs = []
  viewport.device = 'phone'
  const host = document.createElement('div')
  document.body.append(host)
  const side = mount(Sidebar, { target: host, props: { side: 'left' } })
  const bar = mount(Titlebar, { target: host, props: { onpalette: () => undefined } })
  try {
    workspace.showPanel('tree')
    flushSync()
    const inHead = host.querySelector<HTMLButtonElement>('.head [data-side-toggle="left"]')!
    const inBar = host.querySelector<HTMLButtonElement>('header [data-side-toggle="left"]')!
    expect(inHead.classList.contains('nib-said')).toBe(true)
    expect(inHead.getAttribute('aria-label')).toBe('Hide left sidebar')
    expect(inBar.classList.contains('nib-said')).toBe(true)

    inHead.click()
    flushSync()
    expect(workspace.openOn('left')).toBeFalsy()

    fullscreen.on = true
    workspace.showPanel('tree')
    flushSync()
    expect(
      host.querySelector('.head [data-side-toggle="left"]')?.classList.contains('nib-said'),
    ).toBe(false)
  } finally {
    fullscreen.on = false
    viewport.device = 'desktop'
    void unmount(bar, { outro: false })
    void unmount(side, { outro: false })
  }
})
