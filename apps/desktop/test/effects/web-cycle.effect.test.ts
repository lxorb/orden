import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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

vi.mock('../../src/lib/own-window', () => ({
  hearHere: () => Promise.resolve(() => undefined),
}))

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
  const rect = this.isConnected
    ? { x: 0, y: 40, width: 800, height: 560 }
    : { x: 0, y: 0, width: 0, height: 0 }
  return {
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  }
}

document.elementFromPoint = () => document.querySelector('.hole')

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')
const { saver } = await import('../../src/lib/web-tab/src/saver.svelte')
const { startup } = await import('../../src/lib/startup.svelte')
const { cycleTab } = await import('../../src/lib/tab-cycle.svelte')
const { default: Cycling } = await import('./Cycling.svelte')

await Promise.all([
  import('../../src/lib/web-tab/src/visited'),
  import('../../src/lib/web-tab/src/web-data.svelte'),
  import('../../src/lib/web-tab/src/merged'),
  import('../../src/lib/web-tab/src/keys'),
  import('../../src/lib/web-tab/src/downloads.svelte'),
  import('../../src/lib/web-tab/src/resting'),
])

let target: HTMLElement

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  })
  asked.length = 0
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  saver.set('off')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id)
  target.remove()
  vi.useRealTimers()
})

async function frames(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300)
}

async function tenTabs(): Promise<string[]> {
  startup.reset()
  const shown = startup.shown()
  await frames()
  await shown

  const ids: string[] = []
  for (let at = 0; at < 10; at += 1) {
    workspace.openWebsite()
    const tab = workspace.tabs.at(-1)
    if (!tab) throw new Error('no web tab was opened')
    pages.of(tab.id).url = `https://site${String(at)}.example.com/`
    ids.push(tab.id)
  }
  return ids
}

async function cycle(times: number): Promise<void> {
  for (let step = 0; step < times; step += 1) {
    cycleTab(1)
    flushSync()
    await frames()
  }
}

function builds(ids: readonly string[]): number[] {
  return ids.map(
    (id) => asked.filter((one) => one.command === 'web_open' && one.args.tab === id).length,
  )
}

test('going round ten web tabs twice builds each page once and closes none', async () => {
  const ids = await tenTabs()
  const pane = mount(Cycling, { target })
  flushSync()
  await frames()

  await cycle(20)

  expect(builds(ids)).toEqual(ids.map(() => 1))
  expect(asked.map((one) => one.command)).not.toContain('web_close')

  void unmount(pane)
})

test('and once more after a break long enough to freeze them: woken, not built', async () => {
  const ids = await tenTabs()
  const pane = mount(Cycling, { target })
  flushSync()
  await frames()
  await cycle(10)

  await vi.advanceTimersByTimeAsync(10 * 60_000)
  const frozen = asked.filter((one) => one.command === 'web_pause' && one.args.paused === true)
  expect(frozen).toHaveLength(9)

  await cycle(10)

  const woken = asked.filter((one) => one.command === 'web_pause' && one.args.paused === false)
  expect(woken.map((one) => one.args.tab).sort()).toEqual(frozen.map((one) => one.args.tab).sort())
  expect(builds(ids)).toEqual(ids.map(() => 1))
  expect(asked.map((one) => one.command)).not.toContain('web_close')

  void unmount(pane)
})

test('with Memory saver at its most, the old cap comes back', async () => {
  saver.set('maximum')
  const ids = await tenTabs()
  const pane = mount(Cycling, { target })
  flushSync()
  await frames()

  await cycle(20)

  expect(asked.filter((one) => one.command === 'web_close').length).toBeGreaterThan(0)
  expect(builds(ids).some((count) => count > 1)).toBe(true)

  void unmount(pane)
})
