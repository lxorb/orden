import 'fake-indexeddb/auto'
import { newKeyring } from '@orden/pass/keys'
import { flushSync, mount, unmount } from 'svelte'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Account } from '../accounts/src/routes'

vi.mock('../ai/keys', () => ({
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../protect/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

vi.mock('../settings.svelte', async (original) => ({
  ...(await original<typeof import('../settings.svelte')>()),
  passOn: () => true,
}))

const { account } = await import('../accounts/src/account.svelte')
const { configurePass, pass } = await import('./store.svelte')
const PassTab = (await import('./PassTab.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined
let setupSeen = 0
const watcher = new MutationObserver(() => {
  if (target.textContent.includes('Set up Pass')) setupSeen++
})

async function settled(): Promise<void> {
  for (let tries = 0; tries < 10; tries++) {
    flushSync()
    await new Promise((done) => setTimeout(done, 20))
  }
}

async function until(ready: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    flushSync()
    if (ready()) return
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error(`never: ${what}`)
}

function signedInAs(id: string): void {
  account.token = `token-${id}`
  account.user = { id, email: `${id}@example.com` } as Account
  flushSync()
}

beforeAll(() => {
  target = document.createElement('div')
  document.body.append(target)
  watcher.observe(target, { childList: true, subtree: true, characterData: true })
  signedInAs('ada')
  shown = mount(PassTab, { target, props: { tab: null, focused: true }, intro: false })
  flushSync()
})

afterAll(() => {
  watcher.disconnect()
  if (shown) void unmount(shown)
  target.remove()
})

describe('Pass before the account has answered', () => {
  test('waits instead of offering setup while the account is unheard', async () => {
    await settled()
    expect(pass.state).toBe('loading')
    expect(target.querySelector('input[type=password]')).toBeNull()
    expect(setupSeen).toBe(0)
  })

  test('offers setup once the account answered without a vault', async () => {
    pass.accountHeard('ada')
    await until(() => pass.state === 'new', 'the setup screen')
    expect(target.textContent).toContain('Set up Pass')
  })

  test('waits again for another account, then opens to its lock, never setup', async () => {
    signedInAs('grace')
    await until(() => pass.state === 'loading', 'waiting for the other account')
    setupSeen = 0
    await settled()
    expect(setupSeen).toBe(0)
    const made = await newKeyring('correct horse battery staple', FAST)
    pass.tookKeyring({ keyring: made.keyring, rev: 1, pending: false })
    pass.accountHeard('grace')
    await until(() => pass.state === 'locked', 'the lock')
    await settled()
    expect(pass.state).toBe('locked')
    expect(setupSeen).toBe(0)
  })
})
