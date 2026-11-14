import { flushSync } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

let answer: string | null = null

vi.mock('../../src/lib/platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: vi.fn((command: string) =>
    Promise.resolve(command === 'quick_add_key' ? answer : undefined),
  ),
}))

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: { request: (_name: string, _how: unknown, held: () => Promise<void>) => held() },
})

const { listen } = await import('../../src/lib/quick-add/anywhere.svelte')
const { quickAdd } = await import('../../src/lib/quick-add/asked.svelte')

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  quickAdd.anywhere = true
})

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) {
    flushSync()
    await Promise.resolve()
  }
}

test('is what the crate holds, not what the switch asks for', async () => {
  quickAdd.anywhere = true
  answer = null
  stop = listen()
  await settled()
  expect(quickAdd.held).toBe(false)

  answer = 'Control+Alt+Space'
  quickAdd.anywhere = false
  await settled()
  quickAdd.anywhere = true
  await settled()
  expect(quickAdd.held).toBe(true)

  answer = null
  quickAdd.anywhere = false
  await settled()
  expect(quickAdd.held).toBe(false)
})
