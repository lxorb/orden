import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  desktop: true,
  calls: [] as string[],
  answers: new Map<string, (args: unknown) => unknown>(),
  stored: new Map<string, string>(),
}))

vi.mock('../platform/src/tauri', () => ({
  get isDesktop() {
    return world.desktop
  },
  invoke: (command: string, args: unknown) => {
    world.calls.push(command)
    const answer = world.answers.get(command)
    return answer ? Promise.resolve().then(() => answer(args)) : Promise.resolve(null)
  },
}))
vi.mock('../crate/src/native', () => ({
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null
  },
}))
vi.mock('../message', () => ({
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))
vi.mock('../platform/src/stored', () => ({
  storedText: (key: string) => world.stored.get(key) ?? null,
  keep: (key: string, value: string) => world.stored.set(key, value),
  forget: (key: string) => world.stored.delete(key),
}))

const { local, KEEPS_UP } = await import('./local.svelte')

const MACHINE = {
  fit: 'fits',
  model: { id: 'parakeet', name: 'Parakeet TDT 0.6B v3', bytes: 1000 },
  installed: false,
}

beforeEach(() => {
  world.calls.length = 0
  world.answers.clear()
  world.answers.set('dictation_local', () => local.machine)
  world.stored.clear()
  local.machine = { ...MACHINE, fit: 'fits' }
  local.fetching = null
  local.trouble = ''
  local.pace = null
})

describe('the download', () => {
  test('says how far it has come, and leaves the model installed', async () => {
    const seen: number[] = []
    world.answers.set('dictation_local_fetch', (args) => {
      const { progress } = args as { progress: { onmessage: (one: unknown) => void } }
      progress.onmessage({ done: 400, total: 1000 })
      seen.push(local.fetching?.done ?? -1)
      progress.onmessage({ done: 1000, total: 1000 })
      return null
    })
    await local.fetch()
    expect(seen).toEqual([400])
    expect(local.fetching).toBeNull()
    expect(local.ready).toBe(true)
  })

  test('is not started twice, nor for a model already here', async () => {
    world.answers.set('dictation_local_fetch', () => new Promise(() => undefined))
    void local.fetch()
    void local.fetch()
    await vi.waitFor(() => expect(world.calls).toContain('dictation_local_fetch'))
    expect(world.calls.filter((one) => one === 'dictation_local_fetch')).toHaveLength(1)
    local.fetching = null
    world.calls.length = 0
    local.machine = { ...MACHINE, fit: 'fits', installed: true }
    await local.fetch()
    expect(world.calls).toEqual([])
  })

  test('that fails says why, and leaves nothing half there', async () => {
    world.answers.set('dictation_local_fetch', () => {
      throw new Error('encoder.int8.onnx did not arrive as it should; nothing was kept')
    })
    await local.fetch()
    expect(local.trouble).toBe('encoder.int8.onnx did not arrive as it should; nothing was kept')
    expect(local.ready).toBe(false)
    expect(local.fetching).toBeNull()
  })
})

describe('the model here', () => {
  test('keeps the pace it opened at, which decides whether it keeps up', async () => {
    world.answers.set('dictation_local_open', () => ({ pace: 0.07 }))
    await local.open()
    expect(local.pace).toBe(0.07)
    expect(local.keepsUp).toBe(true)
    expect(world.stored.get('orden:dictation-local-pace')).toBe('0.07')
    world.answers.set('dictation_local_open', () => ({ pace: KEEPS_UP * 2 }))
    await local.open()
    expect(local.keepsUp).toBe(false)
  })

  test('once removed is gone, with its pace', async () => {
    local.machine = { ...MACHINE, fit: 'fits', installed: true }
    local.pace = 0.1
    world.stored.set('orden:dictation-local-pace', '0.1')
    await local.remove()
    expect(world.calls).toEqual(['dictation_local_remove'])
    expect(local.ready).toBe(false)
    expect(local.pace).toBeNull()
    expect(world.stored.has('orden:dictation-local-pace')).toBe(false)
  })
})
