import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import '../test/no-device'

vi.mock('@orden/pass/totp', async (importOriginal) => {
  const real = await importOriginal<typeof import('@orden/pass/totp')>()
  return { ...real, code: vi.fn(() => Promise.resolve({ code: '123456', remaining: 20 })) }
})
const { code } = await import('@orden/pass/totp')
const ShownTotp = (await import('../test/ShownTotp.svelte')).default
const SECRET = 'otpauth://totp/Site:me?secret=JBSWY3DPEHPK3PXP&issuer=Site'
let made: { show: (on: boolean) => void } | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(code).mockClear()
})
afterEach(() => {
  if (made) void unmount(made, { outro: false })
  made = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})
test('a 2FA code ticks only while its tab is shown, and is made anew the moment the tab comes back', () => {
  const row = mount(ShownTotp, { target: document.body, props: { secret: SECRET } }) as unknown as {
    show: (on: boolean) => void
  }
  made = row
  flushSync()
  const first = vi.mocked(code).mock.calls.length
  expect(first).toBeGreaterThan(0)
  vi.advanceTimersByTime(3000)
  expect(vi.mocked(code).mock.calls.length).toBe(first + 3)
  row.show(false)
  flushSync()
  const hidden = vi.mocked(code).mock.calls.length
  vi.advanceTimersByTime(5000)
  expect(vi.mocked(code).mock.calls.length).toBe(hidden)
  row.show(true)
  flushSync()
  expect(vi.mocked(code).mock.calls.length).toBe(hidden + 1)
  vi.advanceTimersByTime(1000)
  expect(vi.mocked(code).mock.calls.length).toBe(hidden + 2)
})
