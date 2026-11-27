import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const account = { signedIn: true, open: false }
const sync = {
  status: 'idle',
  lastError: null as string | null,
  remoteIdFor: (root: string) => (root === '/kept' ? 's1' : null),
}
const workspace = { activeSpace: { root: '/kept' } as { root: string } | null }
const left = new Map<string, string>()
vi.mock('../../accounts/src/api', () => ({ account }))
vi.mock('../../sync-store/src/api', () => ({ sync }))
vi.mock('../../workspace/src/api', () => ({ workspace }))
vi.mock('../../left-spaces/src/api', () => ({ leftBy: (root: string) => left.get(root) ?? null }))
const SyncNotice = (await import('./SyncNotice.svelte')).default
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  Object.assign(account, { signedIn: true, open: false })
  Object.assign(sync, { status: 'idle', lastError: null })
  workspace.activeSpace = { root: '/kept' }
  left.clear()
  document.body.innerHTML = ''
})
function shown(): string | null {
  const host = document.createElement('div')
  document.body.append(host)
  const made = mount(SyncNotice, { target: host })
  flushSync()
  const before = host.textContent.trim()
  vi.advanceTimersByTime(2000)
  flushSync()
  const said = host.querySelector('[role=status]')?.textContent.trim() ?? null
  void unmount(made)
  expect(before).toBe('')
  return said
}
test('says a space that synced with an account is not syncing while this device is signed out, with a way in (#2556)', () => {
  account.signedIn = false
  left.set('/kept', 'u1')
  expect(shown()).toBe('Not syncing. This is what this device last saw. Sign in')
})
test('names what stopped sync, or says it is off, while signed in (#2556)', () => {
  Object.assign(sync, { status: 'error', lastError: 'the account is out of space' })
  expect(shown()).toBe('Not syncing: the account is out of space.')
  Object.assign(sync, { status: 'off', lastError: null })
  expect(shown()).toBe('Not syncing. Sync is off on this device.')
})
test('says nothing while sync runs, for a space that never synced, or for no space (#2556)', () => {
  for (const status of ['idle', 'syncing', 'offline']) {
    sync.status = status
    expect(shown()).toBeNull()
  }
  sync.status = 'error'
  workspace.activeSpace = { root: '/here-only' }
  expect(shown()).toBeNull()
  account.signedIn = false
  expect(shown()).toBeNull()
  workspace.activeSpace = null
  expect(shown()).toBeNull()
})
