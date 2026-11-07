import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import SettingsPanel from '../../src/lib/SettingsPanel.svelte'
import { settings } from '../../src/lib/settings.svelte'
import { viewport } from '../../src/lib/viewport.svelte'

Element.prototype.animate = () =>
  ({ finished: Promise.resolve(), cancel: () => undefined }) as unknown as Animation
globalThis.ResizeObserver = class {
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  viewport.narrow = false
})

function open(narrow: boolean) {
  viewport.narrow = narrow
  settings.section = 'appearance'
  settings.listing = false
  shown = mount(SettingsPanel, { target: document.body })
  flushSync()
  return document.querySelector('[role="region"][aria-label="Settings"]')
}

test('a narrow window shows the list or a pane, one at a time, with a way back', () => {
  const sheet = open(true)
  expect(sheet?.classList.contains('phone')).toBe(true)
  expect(sheet?.querySelector('nav')).toBeNull()
  expect(sheet?.querySelector('.body')).not.toBeNull()

  sheet?.querySelector<HTMLButtonElement>('header .orden-glyph')?.click()
  flushSync()
  expect(settings.listing).toBe(true)
  expect(sheet?.querySelector('nav')).not.toBeNull()
  expect(sheet?.querySelector('.body')).toBeNull()
})

test('a wide window shows the list and the pane side by side', () => {
  const sheet = open(false)
  expect(sheet?.classList.contains('phone')).toBe(false)
  expect(sheet?.querySelector('nav')).not.toBeNull()
  expect(sheet?.querySelector('.body')).not.toBeNull()
})
