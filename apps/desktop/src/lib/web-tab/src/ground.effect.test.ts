import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))
const { watchGround } = await import('./still')
afterEach(() => {
  vi.unstubAllGlobals()
})
test('the app’s ground is read again when the browser is idle, never in the frame a change was made in', async () => {
  const idle = vi.fn()
  const frame = vi.fn()
  vi.stubGlobal('requestIdleCallback', idle)
  vi.stubGlobal('requestAnimationFrame', frame)
  watchGround()
  document.body.setAttribute('data-overview', '')
  await Promise.resolve()
  expect(idle).toHaveBeenCalledTimes(1)
  expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: 1000 })
  expect(frame).not.toHaveBeenCalled()
  document.body.setAttribute('data-overview', 'more')
  await Promise.resolve()
  expect(idle).toHaveBeenCalledTimes(1)
})
