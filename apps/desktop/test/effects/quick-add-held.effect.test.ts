import { afterEach, expect, test, vi } from 'vitest'
import { settle } from './settle'

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

const { listen } = await import('../../src/lib/quick-add/src/anywhere.svelte')
const { quickAdd } = await import('../../src/lib/quick-add/src/asked.svelte')

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  quickAdd.anywhere = true
})

test('is what the crate holds, not what the switch asks for', async () => {
  quickAdd.anywhere = true
  answer = null
  stop = listen()
  await settle()
  expect(quickAdd.held).toBe(false)

  answer = 'Control+Alt+Space'
  quickAdd.anywhere = false
  await settle()
  quickAdd.anywhere = true
  await settle()
  expect(quickAdd.held).toBe(true)

  answer = null
  quickAdd.anywhere = false
  await settle()
  expect(quickAdd.held).toBe(false)
})
