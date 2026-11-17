import { beforeEach, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const machine = vi.hoisted(() => ({ os: 'macos', keys: new Set<string>(), signedIn: false }))

vi.mock('../../platform/src/tauri', () => ({
  isDesktop: true,
  isNative: true,
  isMobile: false,
  platform: () => machine.os,
  invoke: (command: string, args: { name?: string }) => {
    if (command === 'secret_read')
      return Promise.resolve(machine.keys.has(args.name ?? '') ? 'k' : null)
    if (command === 'chatgpt_account') return Promise.resolve(machine.signedIn ? {} : null)
    return Promise.resolve(null)
  },
}))
vi.mock('./store.svelte', () => ({
  ai: {
    providers: [
      { id: 'anthropic', kind: 'anthropic' },
      { id: 'local', kind: 'claude-code' },
    ],
  },
}))

beforeEach(() => {
  localStorage.clear()
  machine.os = 'macos'
  machine.keys = new Set()
  vi.resetModules()
})

async function checked(): Promise<boolean> {
  const { keysMoved } = await import('./keys-moved.svelte')
  return keysMoved.check()
}

test('a Mac whose key is not here any more is told, once', async () => {
  expect(await checked()).toBe(true)
  expect(await checked()).toBe(false)
})

test('a Mac with its keys typed again is told nothing', async () => {
  machine.keys = new Set(['anthropic'])
  expect(await checked()).toBe(false)
})

test('another machine kept its keys where they were, and is told nothing', async () => {
  machine.os = 'linux'
  expect(await checked()).toBe(false)
})
