/** Two devices of one account, in memory: the account's routes as ai/vault.ts answers
 *  them (services/sync), each device with its own secret store and its own accounts.
 *  A key typed on one reaches the other only once the other is allowed, and what the
 *  account holds never says a key. */

import { describe, expect, test } from 'vitest'
import { added, type Accounts, NONE } from '../accounts'
import type { Base, Contents } from './merge'
import { Vault, type VaultWorld } from './vault.svelte'

interface Row {
  name: string
  pub: string
  wrapped: string | null
}

/** The account, as the Worker keeps it. */
class Account {
  rev = 0
  blob: string | null = null
  devices = new Map<string, Row>()

  answer(path: string, method = 'GET', body: Record<string, unknown> = {}): unknown {
    const url = new URL(path, 'https://x')
    if (method === 'GET' && url.pathname === '/v2/ai') {
      const device = url.searchParams.get('device') ?? ''
      return {
        rev: this.rev,
        blob: this.blob,
        wrapped: this.devices.get(device)?.wrapped ?? null,
        devices: [...this.devices].map(([id, one]) => ({
          id,
          name: one.name,
          pub: one.pub,
          approved: one.wrapped !== null,
        })),
      }
    }
    if (method === 'POST' && url.pathname === '/v2/ai/devices') {
      const id = String(body.id)
      const held = this.devices.get(id)
      this.devices.set(id, {
        name: String(body.name),
        pub: String(body.pub),
        wrapped: held && held.pub === body.pub ? held.wrapped : null,
      })
      return { ok: true }
    }
    const wrapped = /^\/v2\/ai\/devices\/(\w+)\/wrap$/.exec(url.pathname)
    if (method === 'PUT' && wrapped) {
      const row = this.devices.get(wrapped[1] ?? '')
      if (!row) throw Object.assign(new Error('no such device'), { status: 404 })
      row.wrapped = String(body.wrapped)
      return { ok: true }
    }
    const device = /^\/v2\/ai\/devices\/(\w+)$/.exec(url.pathname)
    if (method === 'DELETE' && device) {
      this.devices.delete(device[1] ?? '')
      return { ok: true }
    }
    if (method === 'PUT' && url.pathname === '/v2/ai/vault') {
      if (body.rev !== this.rev) throw Object.assign(new Error('stale'), { status: 409 })
      this.rev += 1
      this.blob = String(body.blob)
      return { rev: this.rev }
    }
    if (method === 'DELETE' && url.pathname === '/v2/ai/vault') {
      this.rev = 0
      this.blob = null
      for (const one of this.devices.values()) one.wrapped = null
      return { ok: true }
    }
    throw new Error(`${method} ${path} is not a route`)
  }
}

/** One device: its secret store, its accounts and keys, and its vault. */
function device(
  account: Account,
  name: string,
  accounts: Accounts = NONE,
  kept: ReadonlyMap<string, string> = new Map(),
) {
  const secrets = new Map(kept)
  const here = { accounts, keys: {} as Record<string, string> }
  const bases = new Map<string, Base>()
  const world: VaultWorld = {
    account: () => 'u1',
    call: <T>(path: string, method?: string, body?: unknown) =>
      Promise.resolve(account.answer(path, method, body as Record<string, unknown>) as T),
    readSecret: (key) => Promise.resolve(secrets.get(key) ?? null),
    writeSecret: (key, value) => {
      secrets.set(key, value)
      return Promise.resolve()
    },
    deviceName: () => name,
    local: () => Promise.resolve({ accounts: here.accounts, keys: { ...here.keys }, seen: {} }),
    apply: (contents: Contents) => {
      here.accounts = contents.accounts
      here.keys = { ...contents.keys }
      return Promise.resolve()
    },
    loadBase: (id) => bases.get(id) ?? null,
    keepBase: (id, base) => {
      if (base) bases.set(id, base)
      else bases.delete(id)
    },
  }
  return { vault: new Vault(world), here, secrets }
}

const keyed = added(NONE, 'anthropic').state

describe('the AI accounts on two devices', () => {
  test('the first device opens at once, and the vault never says a key', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()
    expect(laptop.vault.standing).toBe('open')
    expect(account.rev).toBe(1)
    expect(account.blob).not.toContain('sk-ant-secret')
    expect(JSON.stringify([...account.devices.values()])).not.toContain('sk-ant-secret')
  })

  test('a second device waits with six digits, and once allowed has the accounts and keys', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()

    const phone = device(account, 'Phone')
    await phone.vault.refresh()
    expect(phone.vault.standing).toBe('waiting')
    expect(phone.vault.digits).toMatch(/^\d{3} \d{3}$/)
    expect(phone.here.keys).toEqual({})

    await laptop.vault.refresh()
    expect(laptop.vault.asking).toEqual([
      { id: expect.any(String), name: 'Phone', digits: phone.vault.digits },
    ])
    await laptop.vault.allow(laptop.vault.asking[0]?.id ?? '')

    await phone.vault.refresh()
    expect(phone.vault.standing).toBe('open')
    expect(phone.here.keys).toEqual({ anthropic: 'sk-ant-secret' })
    expect(phone.here.accounts.accounts.map((one) => one.id)).toEqual(['anthropic'])
  })

  test('a change on either device reaches the other', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    await laptop.vault.refresh()
    const phone = device(account, 'Phone')
    await phone.vault.refresh()
    await laptop.vault.refresh()
    await laptop.vault.allow(laptop.vault.asking[0]?.id ?? '')
    await phone.vault.refresh()

    phone.here.keys = { anthropic: 'sk-typed-on-the-phone' }
    phone.here.accounts = added(phone.here.accounts, 'openai').state
    await phone.vault.refresh()
    await laptop.vault.refresh()
    expect(laptop.here.keys.anthropic).toBe('sk-typed-on-the-phone')
    expect(laptop.here.accounts.accounts.map((one) => one.id)).toEqual(['anthropic', 'openai'])
  })

  test('a device not allowed gets nothing, and one turned down asks again from nothing', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()
    const stranger = device(account, 'Stranger')
    await stranger.vault.refresh()
    await laptop.vault.refresh()
    await laptop.vault.deny(laptop.vault.asking[0]?.id ?? '')
    expect(laptop.vault.asking).toEqual([])
    await stranger.vault.refresh()
    expect(stranger.here.keys).toEqual({})
  })

  test('a device of an account with no device left to allow it starts over with its own', async () => {
    const account = new Account()
    const lost = device(account, 'Lost laptop', keyed)
    await lost.vault.refresh()
    // The only device that had the key is gone.
    account.devices.clear()

    const fresh = device(account, 'New laptop', added(NONE, 'openai').state)
    fresh.here.keys = { openai: 'sk-openai' }
    await fresh.vault.refresh()
    expect(fresh.vault.standing).toBe('stranded')
    await fresh.vault.startOver()
    expect(fresh.vault.standing).toBe('open')
    expect(fresh.here.accounts.accounts.map((one) => one.id)).toEqual(['openai'])
  })

  test('the same device, after a restart or a reinstall, opens without asking', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()

    // A new run of the app on the same machine: the secret store kept its device key, and
    // the accounts file went with a reinstall.
    const again = device(account, 'Laptop', NONE, laptop.secrets)
    await again.vault.refresh()
    expect(again.vault.standing).toBe('open')
    expect(again.here.keys).toEqual({ anthropic: 'sk-ant-secret' })
  })
})
