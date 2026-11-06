import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  full: false,
  calls: [] as boolean[],
  page: Object.assign(new EventTarget(), { fullscreenElement: null as object | null }),
  wait: () => new Promise<void>((done) => setTimeout(done, 5)),
}))

vi.mock('../tauri', async (actual) => ({
  whenScreenGivenBack: (await actual<typeof import('../tauri')>()).whenScreenGivenBack,
  currentWindow: async () => {
    await world.wait()
    return {
      isFullscreen: async () => {
        await world.wait()
        return world.full
      },
      setFullscreen: async (on: boolean) => {
        await world.wait()
        world.calls.push(on)
        world.full = on
        world.page.fullscreenElement = on ? {} : null
      },
    }
  },
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    activeTabId: 'deck',
    tabs: [{ id: 'deck', kind: 'note', doc: '# One\n\n---\n\n# Two\n' }],
    flush: () => undefined,
  },
}))

const { present } = await import('./present.svelte')

const settled = () => new Promise((done) => setTimeout(done, 200))

describe('presenting fills the screen and gives it back', () => {
  beforeEach(async () => {
    present.stop()
    await settled()
    world.full = false
    world.calls = []
  })

  test('fills the screen and leaves it', async () => {
    present.start()
    await settled()
    expect(world.full).toBe(true)

    present.stop()
    await settled()
    expect(world.full).toBe(false)
  })

  test('pressed twice at once, leaves the window as it was', async () => {
    present.toggle()
    present.toggle()
    await settled()

    expect(present.on).toBe(false)
    expect(world.full).toBe(false)
  })

  test('pressed three times at once, presents on a full screen', async () => {
    present.toggle()
    present.toggle()
    present.toggle()
    await settled()

    expect(present.on).toBe(true)
    expect(world.full).toBe(true)
  })

  test('leaves a window that was already full screen full screen', async () => {
    world.full = true
    present.start()
    await settled()
    present.stop()
    await settled()

    expect(world.full).toBe(true)
    expect(world.calls).toEqual([])
  })
})

describe('presenting in a browser', () => {
  beforeEach(async () => {
    present.stop()
    await settled()
    world.full = false
    world.calls = []
    world.page.fullscreenElement = null
    vi.stubGlobal('document', world.page)
  })

  afterEach(async () => {
    present.stop()
    await settled()
    vi.unstubAllGlobals()
  })

  test('ends when the browser gives its full screen back, as Escape does', async () => {
    present.start()
    await settled()
    expect(world.calls).toEqual([true])
    expect(present.on).toBe(true)

    world.page.fullscreenElement = null
    world.page.dispatchEvent(new Event('fullscreenchange'))
    expect(present.on).toBe(false)
  })

  test('begun in a full screen already, ends with it too', async () => {
    world.full = true
    world.page.fullscreenElement = {}
    present.start()
    await settled()
    expect(world.calls).toEqual([])

    world.page.fullscreenElement = null
    world.page.dispatchEvent(new Event('fullscreenchange'))
    expect(present.on).toBe(false)
    expect(world.calls).toEqual([])
  })
})
