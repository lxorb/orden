/** Two devices of one account, in memory: the account's routes as ai/vault.ts answers
 *  them (services/sync), each device with its own secret store and its own accounts.
 *  A key typed on one reaches the other only once the other is allowed, and what the
 *  account holds never says a key. */

import { describe, expect, test } from 'vitest'
import { added, type Accounts, NONE } from '../accounts'
import type { Base, Contents } from './merge'
import { newDeviceKey, newNonce } from './crypto'
import { Vault, type VaultWorld } from './vault.svelte'

interface Row {
  name: string
  commitment: string
  nonce: string | null
  nonceFrom: string | null
  pub: string | null
  revealed: string | null
  wrapped: string | null
}

const bytes = (text: string) => Uint8Array.from(atob(text), (one) => one.charCodeAt(0))

async function sha(...parts: string[]): Promise<string> {
  const all = parts.map(bytes)
  const joined = new Uint8Array(all.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of all) {
    joined.set(one, at)
    at += one.length
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined))
  return [...digest].map((one) => one.toString(16).padStart(2, '0')).join('')
}

const refused = (status: number, said: string) => Object.assign(new Error(said), { status })

/** The account, as the Worker keeps it, with the Worker's checks (services/sync/src/ai/
 *  vault.ts): a reveal has to be what was committed to and the key its id names, and
 *  every change but a device's own asking has to carry the vault key's token. */
class Account {
  rev = 0
  blob: string | null = null
  authHash: string | null = null
  devices = new Map<string, Row>()

  private async holds(auth: unknown): Promise<boolean> {
    return typeof auth === 'string' && this.authHash !== null && (await sha(auth)) === this.authHash
  }

  private allowed(): boolean {
    return [...this.devices.values()].some((one) => one.wrapped !== null)
  }

  async answer(path: string, method = 'GET', body: Record<string, unknown> = {}): Promise<unknown> {
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
          commitment: one.commitment,
          nonce: one.nonce,
          nonceFrom: one.nonceFrom,
          revealed: one.revealed,
          approved: one.wrapped !== null,
        })),
      }
    }
    if (method === 'POST' && url.pathname === '/v2/ai/devices') {
      const id = String(body.id)
      const held = this.devices.get(id)
      if (held?.wrapped) held.name = String(body.name)
      else {
        this.devices.set(id, {
          name: String(body.name),
          commitment: String(body.commitment),
          nonce: null,
          nonceFrom: null,
          pub: null,
          revealed: null,
          wrapped: null,
        })
      }
      return { ok: true }
    }
    const step = /^\/v2\/ai\/devices\/(\w+)\/(nonce|reveal|wrap)$/.exec(url.pathname)
    if (method === 'PUT' && step) {
      const id = step[1] ?? ''
      const row = this.devices.get(id)
      if (!row) throw refused(404, 'no such device')
      if (step[2] === 'nonce') {
        if (!(await this.holds(body.auth))) throw refused(403, 'not the vault key')
        if (row.wrapped || row.pub || (row.nonce && row.nonceFrom !== body.from)) {
          throw refused(409, 'answered already')
        }
        row.nonce = String(body.nonce)
        row.nonceFrom = String(body.from)
        return { ok: true }
      }
      if (step[2] === 'reveal') {
        const pub = String(body.pub)
        if (row.pub) throw refused(409, 'revealed already')
        if ((await sha(pub)).slice(0, 32) !== id) throw refused(400, 'that key is not this device')
        const committed = [...bytes(row.commitment)]
          .map((one) => one.toString(16).padStart(2, '0'))
          .join('')
        if ((await sha(pub, String(body.nonce))) !== committed) {
          throw refused(400, 'not what this device committed to')
        }
        if (!row.nonce && (this.blob !== null || this.allowed()))
          throw refused(409, 'not answered yet')
        row.pub = pub
        row.revealed = String(body.nonce)
        return { ok: true }
      }
      if (!(await this.holds(body.auth))) throw refused(403, 'not the vault key')
      if (!row.pub) throw refused(404, 'no such device')
      row.wrapped = String(body.wrapped)
      return { ok: true }
    }
    const device = /^\/v2\/ai\/devices\/(\w+)$/.exec(url.pathname)
    if (method === 'DELETE' && device) {
      const row = this.devices.get(device[1] ?? '')
      if (!row) throw refused(404, 'no such device')
      if (row.wrapped && !(await this.holds(body.auth))) throw refused(403, 'not the vault key')
      this.devices.delete(device[1] ?? '')
      return { ok: true }
    }
    if (method === 'PUT' && url.pathname === '/v2/ai/vault') {
      if (body.rev === 0) {
        if (this.blob !== null) throw refused(409, 'stale')
        this.authHash = await sha(String(body.auth))
      } else {
        if (!(await this.holds(body.auth))) throw refused(403, 'not the vault key')
        if (body.rev !== this.rev) throw refused(409, 'stale')
      }
      this.rev += 1
      this.blob = String(body.blob)
      return { rev: this.rev }
    }
    if (method === 'DELETE' && url.pathname === '/v2/ai/vault') {
      if (!(await this.holds(body.auth)) && this.allowed()) throw refused(403, 'not the vault key')
      this.rev = 0
      this.blob = null
      this.authHash = null
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
    call: async <T>(path: string, method?: string, body?: unknown) =>
      (await account.answer(path, method, body as Record<string, unknown>)) as T,
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

/** The three steps of letting a device in, as the devices' own reads take them: the
 *  phone has asked, the laptop answers, the phone reveals, the laptop lists it. */
async function letIn(laptop: ReturnType<typeof device>, phone: ReturnType<typeof device>) {
  await phone.vault.refresh()
  await laptop.vault.refresh()
  await phone.vault.refresh()
  await laptop.vault.refresh()
}

describe('the AI accounts on two devices', () => {
  test('the first device opens at once, and the vault never says a key', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()
    expect(laptop.vault.standing).toBe('open')
    expect(account.rev).toBeGreaterThanOrEqual(1)
    expect(account.blob).not.toContain('sk-ant-secret')
    expect(JSON.stringify([...account.devices.values()])).not.toContain('sk-ant-secret')
  })

  test('a second device waits, shows the six digits the first shows, and once allowed has the accounts and keys', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()

    const phone = device(account, 'Phone')
    await phone.vault.refresh()
    expect(phone.vault.standing).toBe('waiting')
    // Nothing to compare until a device with the key has answered.
    expect(phone.vault.digits).toBe('')
    await laptop.vault.refresh()
    await phone.vault.refresh()
    expect(phone.vault.digits).toMatch(/^\d{3} \d{3}$/)
    expect(phone.here.keys).toEqual({})

    await laptop.vault.refresh()
    expect(laptop.vault.asking).toEqual([
      {
        id: expect.any(String),
        name: 'Phone',
        digits: phone.vault.digits,
        pub: expect.any(String),
      },
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
    await letIn(laptop, phone)
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
    await letIn(laptop, stranger)
    await laptop.vault.deny(laptop.vault.asking[0]?.id ?? '')
    expect(laptop.vault.asking).toEqual([])
    await stranger.vault.refresh()
    expect(stranger.here.keys).toEqual({})
    expect(stranger.vault.standing).toBe('waiting')
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

describe('somebody between the two screens', () => {
  /** A key of the attacker's own, put in the place of the phone's after the reader saw
   *  the phone's digits: nothing is wrapped to it. */
  test('cannot change the key under the digits the reader compared', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    laptop.here.keys = { anthropic: 'sk-ant-secret' }
    await laptop.vault.refresh()
    const phone = device(account, 'Phone')
    await letIn(laptop, phone)
    const shown = laptop.vault.asking[0]
    expect(shown?.digits).toBe(phone.vault.digits)

    const thief = await newDeviceKey()
    const row = account.devices.get(shown?.id ?? '')
    if (row) row.pub = thief.pub
    await laptop.vault.allow(shown?.id ?? '')
    expect(row?.wrapped).toBeNull()
    expect(laptop.vault.asking).toEqual([])
  })

  /** A key revealed that is not the one the device committed to, or not the one its id
   *  names, is never shown to the reader at all. */
  test('cannot reveal a key the asking device did not commit to', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    await laptop.vault.refresh()
    const phone = device(account, 'Phone')
    await phone.vault.refresh()
    await laptop.vault.refresh()
    await phone.vault.refresh()

    const thief = await newDeviceKey()
    const row = [...account.devices.values()].find((one) => one.name === 'Phone')
    if (row) row.pub = thief.pub
    await laptop.vault.refresh()
    expect(laptop.vault.asking).toEqual([])
  })

  /** The attacker's own device asking in the phone's place: it is bound to its key before
   *  the laptop picks its nonce, so the digits the laptop shows for it are not the ones
   *  the phone shows, which the phone worked out against a nonce of the attacker's
   *  choosing and a nonce of its own the attacker never saw in time. */
  test('cannot pick a key that shows the digits the reader’s own device shows', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    await laptop.vault.refresh()

    // The thief asks with a device of its own, and the laptop answers it.
    const thief = device(account, 'Phone')
    await thief.vault.refresh()
    await laptop.vault.refresh()
    await thief.vault.refresh()
    await laptop.vault.refresh()
    const forThief = laptop.vault.asking[0]?.digits

    // The reader's phone, answered by a nonce the thief makes up, never by the laptop.
    const phone = device(account, 'Phone')
    await phone.vault.refresh()
    const own = [...account.devices.entries()].find(
      ([id, one]) => one.name === 'Phone' && id !== laptop.vault.asking[0]?.id && !one.pub,
    )
    const laptopId = [...account.devices.entries()].find(([, one]) => one.name === 'Laptop')?.[0]
    if (own) {
      own[1].nonce = newNonce()
      own[1].nonceFrom = laptopId ?? null
    }
    await phone.vault.refresh()
    expect(phone.vault.digits).toMatch(/^\d{3} \d{3}$/)
    expect(forThief).toMatch(/^\d{3} \d{3}$/)
    expect(phone.vault.digits).not.toBe(forThief)
  })

  test('cannot answer, wrap, write the vault or let it go without the vault key', async () => {
    const account = new Account()
    const laptop = device(account, 'Laptop', keyed)
    await laptop.vault.refresh()
    const phone = device(account, 'Phone')
    await phone.vault.refresh()
    const id = [...account.devices.entries()].find(([, one]) => one.name === 'Phone')?.[0] ?? ''

    const forged = { auth: btoa('not the key') }
    await expect(
      account.answer(`/v2/ai/devices/${id}/nonce`, 'PUT', {
        nonce: newNonce(),
        from: id,
        ...forged,
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      account.answer(`/v2/ai/devices/${id}/wrap`, 'PUT', { wrapped: 'eA', ...forged }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      account.answer('/v2/ai/vault', 'PUT', { rev: account.rev, blob: 'eA', ...forged }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(account.answer('/v2/ai/vault', 'DELETE', forged)).rejects.toMatchObject({
      status: 403,
    })
  })
})
