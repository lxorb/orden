import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { settle } from './settle'

const asked: { command: string; args: Record<string, unknown> }[] = []
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    return Promise.resolve(undefined)
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))
vi.mock('../../src/lib/windows/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/windows/src/api')>()),
  hearHere: (event: string) =>
    event === 'orden://keyboard-left-page'
      ? Promise.reject(new Error('no window to hear in'))
      : Promise.resolve(() => undefined),
}))
const { workspace } = await import('../../src/lib/workspace/src/api')
const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')
const WebTab = (await import('../../src/lib/web-tab/src/WebTab.svelte')).default
const STOPS = 'a[href], button, input, select, textarea, [tabindex]'
let target: HTMLElement
beforeEach(() => {
  asked.length = 0
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  target.remove()
})
async function shown() {
  const id = workspace.openPage('https://example.com/')
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab) throw new Error('no tab')
  const page = pages.of(tab.id)
  page.live = true
  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  await settle()
  const hole = target.querySelector<HTMLElement>('.hole')
  if (!hole) throw new Error('no slot for the page')
  const done = () => {
    void unmount(app)
    workspace.close(tab.id)
  }
  return { tab, page, hole, done }
}
function order(): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>(STOPS)].filter(
    (one) => one.tabIndex >= 0 && !(one as HTMLButtonElement).disabled,
  )
}
test("one Tab from the bar's last control reaches the page, even with a still of it kept for a layer", async () => {
  const { page, hole, done } = await shown()
  try {
    page.shot = 'data:image/png;base64,AAAA'
    flushSync()
    const stops = order()
    const more = stops.findIndex((one) => one.getAttribute('aria-label') === 'More')
    expect(more).toBeGreaterThanOrEqual(0)
    expect(stops[more + 1]).toBe(hole)
    expect(hole.tabIndex).toBe(0)
  } finally {
    done()
  }
})
test('a page not yet live is passed over', async () => {
  const { page, hole, done } = await shown()
  try {
    page.live = false
    flushSync()
    expect(hole.tabIndex).toBe(-1)
  } finally {
    done()
  }
})
test('the slot taking the keyboard from Tab hands it into the page, from its end when Tab comes back', async () => {
  const { tab, hole, done } = await shown()
  try {
    const more = order().find((one) => one.getAttribute('aria-label') === 'More')
    hole.matches = (selector: string) => selector === ':focus-visible' || Element.prototype.matches.call(hole, selector)
    hole.dispatchEvent(new FocusEvent('focus', { relatedTarget: more ?? null }))
    const after = document.createElement('button')
    target.append(after)
    hole.dispatchEvent(new FocusEvent('focus', { relatedTarget: after }))
    const into = asked.filter((one) => one.command === 'keyboard_into').map((one) => one.args)
    expect(into).toEqual([
      { tab: tab.id, last: false },
      { tab: tab.id, last: true },
    ])
  } finally {
    done()
  }
})
test('a window that cannot be heard in leaves no rejection behind', async () => {
  const rejected: unknown[] = []
  const heard = (reason: unknown) => rejected.push(reason)
  process.on('unhandledRejection', heard)
  try {
    const { done } = await shown()
    await settle()
    done()
    await settle()
    expect(rejected).toEqual([])
  } finally {
    process.off('unhandledRejection', heard)
  }
})
