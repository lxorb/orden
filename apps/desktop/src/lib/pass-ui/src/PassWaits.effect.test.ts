import { newKeyring } from '@orden/pass/keys'
import { flushSync } from 'svelte'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { closed, draw, landed, target, until } from '../test/drawn'
import { FAST, PASSWORD, pass } from '../test/opened'
import type { Account } from '../../accounts/src/routes'

vi.mock('../../gates/src/api', async (original) => ({
  ...(await original<typeof import('../../gates/src/api')>()),
  passOn: () => true,
}))

const { account } = await import('../../accounts/src/account.svelte')
const PassTab = (await import('./PassTab.svelte')).default

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

function signedInAs(id: string): void {
  account.token = `token-${id}`
  account.user = { id, email: `${id}@example.com` } as Account
  flushSync()
}

beforeAll(() => {
  landed()
  watcher.observe(target, { childList: true, subtree: true, characterData: true })
  signedInAs('ada')
  draw(PassTab, { tab: null, focused: true })
})

afterAll(() => {
  watcher.disconnect()
  closed()
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
    const made = await newKeyring(PASSWORD, FAST)
    pass.tookKeyring({ keyring: made.keyring, rev: 1, pending: false })
    pass.accountHeard('grace')
    await until(() => pass.state === 'locked', 'the lock')
    await settled()
    expect(pass.state).toBe('locked')
    expect(setupSeen).toBe(0)
  })
})
