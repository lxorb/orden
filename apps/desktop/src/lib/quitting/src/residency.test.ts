import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const host = vi.hoisted(() => ({
  stored: null as string | null,
  calls: [] as { on: unknown }[],
  kept: [] as boolean[],
}))
vi.mock('../../platform/src/api', () => ({
  isDesktop: true,
  platform: () => 'windows',
  storedText: () => host.stored,
  keep: (_key: string, value: string) => {
    host.stored = value
    return true
  },
  invoke: (command: string, args: { on?: unknown }) => {
    if (command === 'tray_keep') host.calls.push({ on: args.on })
    return Promise.resolve(true)
  },
}))
vi.mock('../../parting/src/api', () => ({
  keptInTray: (hide: unknown) => host.kept.push(hide !== null),
}))
async function started(stored: string | null) {
  host.stored = stored
  host.calls = []
  host.kept = []
  vi.resetModules()
  const { residency } = await import('./residency.svelte')
  residency.apply()
  return residency
}
describe('the tray', () => {
  beforeEach(() => vi.resetModules())
  test('is put up as the app starts when Stay in the tray is on', async () => {
    await started('on')
    expect(host.calls).toEqual([{ on: true }])
    expect(host.kept).toEqual([true])
  })
  test('is settled by the app as it starts', () => {
    const start = readFileSync(join(import.meta.dirname, '../../start.ts'), 'utf8')
    expect(start).toContain("import('./quitting/src/api').then(({ residency }) => residency.apply())")
  })
  test('is not put up as the app starts when it is off or nothing asks for it', async () => {
    await started('off')
    expect(host.calls).toEqual([{ on: false }])
    await started(null)
    expect(host.calls).toEqual([{ on: false }])
  })
  test('follows the switch and is told only when it changes', async () => {
    const residency = await started('off')
    residency.set(true)
    residency.set(true)
    residency.set(false)
    expect(host.calls).toEqual([{ on: false }, { on: true }, { on: false }])
    expect(host.stored).toBe('off')
  })
  test('left to itself, is up while chats can send notices', async () => {
    const residency = await started(null)
    residency.chats = true
    residency.chats = false
    expect(host.calls).toEqual([{ on: false }, { on: true }, { on: false }])
  })
})
