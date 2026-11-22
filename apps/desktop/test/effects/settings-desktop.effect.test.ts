import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  invoke: () => Promise.reject(new Error('no crate')),
}))
const { providePort, registered } = await import('@orden/contracts')
const { settings } = await import('../../src/lib/settings/src/api')
const { sectionGroups } = await import('../../src/lib/settings/src/sections')
const { default: SettingsPanel } = await import('../../src/lib/settings/src/SettingsPanel.svelte')
await import('../../src/lib/web-tab/src/api')
await import('../../src/lib/terminal/src/api')
await registered()
providePort('settings.window', settings)
Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel: () => undefined }) as unknown as Animation
let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
})
async function open(section: 'browser' | 'terminal' | 'general' | 'kinds') {
  settings.section = section
  settings.listing = false
  shown = mount(SettingsPanel, { target: document.body })
  flushSync()
  await tick()
  flushSync()
  return document.querySelector('[role="region"][aria-label="Settings"] .body')?.textContent ?? ''
}
test('the desktop lists Browser after Appearance and Terminal after AI', () => {
  const ids = sectionGroups()
    .flat()
    .map((one) => one.id)
  expect(ids.indexOf('browser')).toBe(ids.indexOf('appearance') + 1)
  expect(ids.indexOf('terminal')).toBe(ids.indexOf('ai') + 1)
  expect(ids).not.toContain('spelling')
  expect(ids).not.toContain('markdown')
})
test('Browser holds the default browser, the search engine and what hidden pages do', async () => {
  const text = await open('browser')
  for (const label of ['Default browser', 'Search engine', 'Performance', 'Memory saver', 'Hidden tabs']) {
    expect(text).toContain(label)
  }
})
test('Terminal holds the terminal’s own settings', async () => {
  expect(await open('terminal')).toContain('Shell')
})
test('General no longer holds the browser, the terminal or Developer mode', async () => {
  const text = await open('general')
  for (const label of ['Default browser', 'Search engine', 'Memory saver', 'Hidden tabs', 'Shell', 'Developer mode']) {
    expect(text).not.toContain(label)
  }
})
test('Note types offers the default browser nowhere', async () => {
  expect(await open('kinds')).not.toContain('Default browser')
})
