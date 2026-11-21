import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const machine = vi.hoisted(() => ({ native: false }))
vi.mock('../../platform/src/api', async (original) => {
  const real = await original<typeof import('../../platform/src/api')>()
  return {
    ...real,
    get isNative() {
      return machine.native
    },
  }
})
const KEY = 'orden:setup'
async function fresh() {
  vi.resetModules()
  const [{ account }, { gate }, { setup }] = await Promise.all([
    import('../../accounts/src/api'),
    import('./gate.svelte'),
    import('./setup-state.svelte'),
  ])
  return { account, gate, setup }
}
async function signIn(account: Awaited<ReturnType<typeof fresh>>['account']) {
  account.token = 'token'
  account.user = { id: 'one', email: 'one@example.com' } as never
  flushSync()
  await Promise.resolve()
  await Promise.resolve()
}
beforeEach(() => {
  localStorage.clear()
  machine.native = false
})
afterEach(() => localStorage.clear())
describe('the setup in a browser', () => {
  test('waits for an account, so trying Orden out opens the app at once', async () => {
    const { account, setup } = await fresh()
    setup.start(false)
    expect(setup.showing).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('"waiting"')
    await signIn(account)
    expect(setup.showing).toBe(true)
    expect(setup.step).toBe('appearance')
  })
  test('still waits after a reload, and begins once the account signs in', async () => {
    localStorage.setItem(KEY, '"waiting"')
    const { account, gate, setup } = await fresh()
    gate.restore()
    await import('./wait')
    expect(setup.showing).toBe(false)
    await signIn(account)
    await vi.waitFor(() => expect(setup.showing).toBe(true))
    expect(setup.step).toBe('appearance')
  })
  test('begins at once for someone already signed in', async () => {
    const { setup } = await fresh()
    setup.start(true)
    expect(setup.showing).toBe(true)
    expect(setup.step).toBe('appearance')
  })
  test('never comes back to someone who finished it', async () => {
    localStorage.setItem(KEY, '"done"')
    const { account, setup } = await fresh()
    setup.start(false)
    await signIn(account)
    expect(setup.showing).toBe(false)
  })
})
describe('the setup on a computer', () => {
  test('opens at the log in as before, with no account yet', async () => {
    machine.native = true
    const { setup } = await fresh()
    setup.start(false)
    expect(setup.showing).toBe(true)
    expect(setup.step).toBe('account')
  })
})
