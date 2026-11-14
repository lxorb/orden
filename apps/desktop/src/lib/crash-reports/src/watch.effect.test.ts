import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ sent: 0 }))

vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

vi.mock('./send', () => ({
  nativeSending: () => ({}),
  sendWaiting: () => {
    world.sent++
    return Promise.resolve('done')
  },
}))

const { watchForCrashes } = await import('./watch.svelte')
const { crashReports } = await import('./choice.svelte')

let stop: (() => void) | null = null

beforeEach(() => {
  localStorage.clear()
  world.sent = 0
})

afterEach(() => {
  stop?.()
  stop = null
})

test('nothing waiting is sent before the first-launch question is answered', async () => {
  crashReports.ask()
  stop = watchForCrashes(true)
  flushSync()
  await Promise.resolve()
  expect(world.sent).toBe(0)

  crashReports.answer(true)
  flushSync()
  expect(world.sent).toBe(1)
})

test('once it is answered, waiting reports go at start', () => {
  localStorage.setItem('orden:crash-reports-told', 'true')
  stop = watchForCrashes(true)
  flushSync()
  expect(world.sent).toBe(1)
})
