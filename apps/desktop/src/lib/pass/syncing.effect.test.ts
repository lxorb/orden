import { afterEach, expect, test, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  syncOnce: vi.fn(),
  account: { user: { id: 'u1', email: 'ada@example.com' }, token: 'token' },
  pass: {
    state: 'open',
    conflict: false,
    start: vi.fn(),
    onLocalChange: vi.fn(),
    backfillTrust: vi.fn(() => Promise.resolve(0)),
  },
  hub: { device: 'device', on: vi.fn(), opened: vi.fn() },
}))

vi.mock('../account.svelte', () => ({ account: fake.account }))
vi.mock('../api', () => ({ BASE: 'http://hub.test', request: vi.fn() }))
vi.mock('../log', () => ({ log: vi.fn() }))
vi.mock('../settings.svelte', () => ({ passOn: () => true }))
vi.mock('../sync2/hub.svelte', () => ({ hub: fake.hub }))
vi.mock('./device-rows', () => ({ deviceRows: {} }))
vi.mock('./exchange', () => ({ syncOnce: fake.syncOnce }))
vi.mock('./store.svelte', () => ({ pass: fake.pass }))
vi.mock('./sync', () => ({ PassApi: vi.fn() }))
vi.mock('./synced', () => ({ invitesOf: () => Promise.resolve([]) }))

afterEach(() => {
  vi.useRealTimers()
})

test('a sync the network refused is tried again soon, not at the next five-minute round', async () => {
  vi.useFakeTimers()
  fake.syncOnce.mockRejectedValue(new TypeError('Failed to fetch'))
  const { passSync, startPassSync } = await import('./syncing.svelte')

  startPassSync()
  await vi.advanceTimersByTimeAsync(0)
  expect(passSync.state).toBe('offline')
  const tried = fake.syncOnce.mock.calls.length
  fake.syncOnce.mockResolvedValue('synced')

  await vi.advanceTimersByTimeAsync(30_000)

  expect(fake.syncOnce.mock.calls.length).toBeGreaterThan(tried)
  expect(passSync.state).toBe('synced')

  const settled = fake.syncOnce.mock.calls.length
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(0)
  expect(fake.syncOnce.mock.calls.length).toBe(settled + 1)
})
