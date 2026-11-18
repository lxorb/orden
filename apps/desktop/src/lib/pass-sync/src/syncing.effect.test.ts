import { afterEach, expect, test, vi } from 'vitest'
import { elapse } from '../../../../test/effects/settle'

const fake = vi.hoisted(() => ({
  syncOnce: vi.fn(),
  account: { user: { id: 'u1', email: 'ada@example.com' }, token: 'token' },
  pass: {
    state: 'open',
    conflict: false,
    start: vi.fn(),
    accountHeard: vi.fn(),
    onLocalChange: vi.fn(),
    backfillTrust: vi.fn(() => Promise.resolve(0)),
  },
  hub: { device: 'device', on: vi.fn(), opened: vi.fn() },
}))

vi.mock('../../accounts/src/account.svelte', () => ({ account: fake.account }))
vi.mock('../../accounts/src/client', () => ({ BASE: 'http://hub.test', request: vi.fn() }))
vi.mock('../../platform/src/log', () => ({ log: vi.fn() }))
vi.mock('../../gates/src/api', () => ({ passOn: () => true }))
vi.mock('../../sync-client/src/api', () => ({ hub: fake.hub }))
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
  await elapse(0)
  expect(passSync.state).toBe('offline')
  const tried = fake.syncOnce.mock.calls.length
  fake.syncOnce.mockResolvedValue('synced')

  await elapse(30_000)

  expect(fake.syncOnce.mock.calls.length).toBeGreaterThan(tried)
  expect(passSync.state).toBe('synced')

  const settled = fake.syncOnce.mock.calls.length
  window.dispatchEvent(new Event('online'))
  await elapse(0)
  expect(fake.syncOnce.mock.calls.length).toBe(settled + 1)
})
