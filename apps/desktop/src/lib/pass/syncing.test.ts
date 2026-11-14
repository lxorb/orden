import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../accounts/test/fakes'
import type { SyncWorld } from './sync-world'

vi.mock('../accounts/src/account.svelte', async () => ({
  account: (await import('../accounts/test/fakes')).accountDouble(),
}))

const server = vi.hoisted(() => ({
  held: null as Promise<void> | null,
  invites: [] as unknown[],
}))

vi.mock('../accounts/src/client', () => ({ BASE: '', request: () => Promise.resolve({}) }))
vi.mock('../platform/src/log', () => ({ log: () => undefined }))
vi.mock('../settings.svelte', () => ({ passOn: () => true }))
vi.mock('../sync-client/src/hub.svelte', () => ({ hub: { device: 'device' } }))
vi.mock('./device-rows', () => ({ deviceRows: {} }))
vi.mock('./sync', () => ({ PassApi: vi.fn() }))
vi.mock('./synced', () => ({ invitesOf: () => Promise.resolve([]) }))
vi.mock('./store.svelte', () => ({
  pass: {
    state: 'open',
    conflict: false,
    start: () => Promise.resolve(),
    accountHeard: () => undefined,
    backfillTrust: () => Promise.resolve(0),
  },
}))
vi.mock('./exchange', () => ({
  syncOnce: async (world: SyncWorld) => {
    await server.held
    world.invited(server.invites as never)
    world.conflicted(true)
    return 'synced'
  },
}))

const { passSync } = await import('./syncing.svelte')
const { pass } = await import('./store.svelte')
const account = (await import('../accounts/src/account.svelte')).account as unknown as AccountDouble

function hold(): () => void {
  let free: () => void = () => undefined
  server.held = new Promise((resolve) => (free = resolve))
  return free
}

beforeEach(() => {
  server.held = null
  server.invites = [{ vault: 'v1' }]
  account.signInAs('a')
  passSync.signedOut()
})

describe('the passwords synced for an account', () => {
  test('say when they last synced and who invited them', async () => {
    await passSync.refresh()
    expect(passSync.state).toBe('synced')
    expect(passSync.at).not.toBeNull()
    expect(passSync.invites).toEqual([{ vault: 'v1' }])
  })

  test('keep nothing of when or who once the account signs out', async () => {
    await passSync.refresh()
    account.signOut()
    passSync.signedOut()

    expect(passSync.at).toBeNull()
    expect(passSync.invites).toEqual([])
  })

  test('never show the next account what the last one’s sync came back with', async () => {
    const free = hold()
    const syncing = passSync.refresh()

    account.signInAs('b')
    passSync.signedOut()
    free()
    await syncing

    expect(passSync.invites).toEqual([])
    expect(passSync.at).toBeNull()
    expect(passSync.state).toBe('off')
    expect(pass.conflict).toBe(false)
  })
})
