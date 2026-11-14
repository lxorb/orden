import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type Channel = 'stable' | 'unstable'

const world = vi.hoisted(() => {
  const state: { desktop: boolean; web: Channel | null; channel: Channel; copied: string[] } = {
    desktop: false,
    web: null,
    channel: 'stable',
    copied: [],
  }
  return state
})

vi.mock('../../platform/src/tauri', () => ({
  get isDesktop() {
    return world.desktop
  },
}))
vi.mock('../../updater', () => ({
  get webChannel() {
    return world.web
  },
}))
vi.mock('../../updates.svelte', () => ({
  updates: {
    get channel() {
      return world.channel
    },
  },
}))
vi.mock('../../ui-controls/src/clipboard', () => ({
  copyText: (text: string) => {
    world.copied.push(text)
    return Promise.resolve()
  },
}))

const { version, versionField } = await import('./version.svelte')

beforeEach(() => {
  world.desktop = false
  world.web = null
  world.channel = 'stable'
  world.copied = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the version', () => {
  test('says the channel a desktop follows beside it', () => {
    world.desktop = true
    world.channel = 'unstable'
    expect(version.said()).toBe('under test, Unstable')
  })

  test('says the build the web app was served beside it, and the commit it was built from', () => {
    world.web = 'stable'
    expect(version.said()).toBe('under test (c0ffee1), Stable')
  })

  test("says the edge's commit, which its number does not", () => {
    world.web = 'unstable'
    expect(version.said()).toBe('under test (c0ffee1), Unstable')
  })

  test('pressed on the web, puts the commit on the clipboard with the version', async () => {
    world.web = 'unstable'
    const field = versionField()
    if (field.kind !== 'value') throw new Error('the version is a value')
    field.press()
    await vi.waitFor(() => expect(world.copied).toEqual(['under test (c0ffee1)']))
  })

  test('is alone on a phone, whose updates are the store’s', () => {
    expect(version.said()).toBe('under test')
  })

  test('is found by version and by about', () => {
    expect(versionField().words).toEqual(expect.arrayContaining(['version', 'about']))
  })

  test('pressed, puts the version alone on the clipboard and says so for a moment', async () => {
    vi.useFakeTimers()
    world.desktop = true
    const field = versionField()
    if (field.kind !== 'value') throw new Error('the version is a value')

    field.press()
    await vi.waitFor(() => expect(world.copied).toEqual(['under test']))
    expect(field.get()).toBe('Copied')
    vi.advanceTimersByTime(1600)
    expect(field.get()).toBe('under test, Stable')
  })
})
