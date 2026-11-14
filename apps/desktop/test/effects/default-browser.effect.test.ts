import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  is: false,
  refuse: null as string | null,
  asked: [] as string[],
  focus: null as ((event: { payload: boolean }) => void) | null,
  stopped: 0,
}))

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string) => {
    world.asked.push(command)
    if (command === 'default_browser') return Promise.resolve(world.is)
    if (command === 'make_default_browser' && world.refuse !== null) {
      return Promise.reject(new Error(world.refuse))
    }
    return Promise.resolve(null)
  },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      world.focus = handler
      return Promise.resolve(() => {
        world.stopped++
      })
    },
  }),
}))

const { default: DefaultBrowser } = await import('../../src/lib/settings/DefaultBrowser.svelte')
const { settings } = await import('../../src/lib/settings.svelte')

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

let host: HTMLElement
let shown: ReturnType<typeof mount> | null = null

async function settled() {
  for (let round = 0; round < 5; round++) await Promise.resolve()
  await vi.waitFor(() => undefined)
  flushSync()
}

function open() {
  shown = mount(DefaultBrowser, { target: host })
  flushSync()
}

async function listening() {
  await vi.waitFor(() => {
    if (!world.focus) throw new Error('not listening to the window yet')
  })
}

const button = () => host.querySelector('button')
const tick = () => host.querySelector('svg.tick')

beforeEach(() => {
  world.is = false
  world.refuse = null
  world.asked = []
  world.focus = null
  world.stopped = 0
  settings.error = null
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  host.remove()
})

test('shows nothing until the system has answered', async () => {
  open()
  expect(button()).toBeNull()
  expect(tick()).toBeNull()

  await settled()
  expect(button()?.textContent.trim()).toBe('Make default')
})

test('a browser already set says so with the tick and offers nothing to press', async () => {
  world.is = true
  open()
  await settled()

  expect(tick()?.getAttribute('aria-label')).toBe('Default')
  expect(button()).toBeNull()
})

test('the press asks the system, and the row asks again when the window comes back', async () => {
  open()
  await settled()
  await listening()

  button()?.click()
  await settled()
  expect(world.asked).toEqual(['default_browser', 'make_default_browser', 'default_browser'])
  expect(button()).not.toBeNull()

  world.is = true
  world.focus?.({ payload: true })
  await settled()
  expect(tick()).not.toBeNull()
  expect(button()).toBeNull()

  const asked = world.asked.length
  world.focus?.({ payload: false })
  await settled()
  expect(world.asked.length).toBe(asked)
})

test('a press the build refuses says why, and the row stays as it was', async () => {
  world.refuse = 'only the installed app can be the default browser'
  open()
  await settled()

  button()?.click()
  await settled()

  expect(settings.error).toBe('only the installed app can be the default browser')
  expect(button()).not.toBeNull()
})

test('closing the settings stops listening to the window', async () => {
  open()
  await settled()
  await listening()

  if (shown) void unmount(shown)
  shown = null
  expect(world.stopped).toBe(1)
})
