import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  full: false,
  calls: [] as boolean[],
  wait: () => new Promise<void>((done) => setTimeout(done, 5)),
}))

vi.mock('../tauri', () => ({
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
