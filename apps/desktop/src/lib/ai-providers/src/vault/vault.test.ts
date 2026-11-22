import { describe, expect, test } from 'vitest'
import { added, type Accounts, NONE, removed, resolve, updated } from '../accounts'
import type { Base, Contents } from './merge'
import { Vault, type VaultWorld } from './vault.svelte'

const refused = (status: number, said: string) => Object.assign(new Error(said), { status })
class Account {
  rev = 0
  contents: string | null = null
  writes = 0
  answer(path: string, method = 'GET', body: Record<string, unknown> = {}): Promise<unknown> {
    if (path !== '/v2/ai/accounts') return Promise.reject(new Error(`${method} ${path} is not a route`))
    if (method === 'GET') return Promise.resolve({ rev: this.rev, contents: this.contents })
    if (body.rev !== this.rev) return Promise.reject(refused(409, 'stale'))
    this.rev += 1
    this.writes += 1
    this.contents = String(body.contents)
    return Promise.resolve({ rev: this.rev })
  }
  held(): Contents {
    return JSON.parse(this.contents ?? 'null') as Contents
  }
}
function device(account: Account, accounts: Accounts = NONE) {
  const here = {
    accounts,
    keys: {} as Record<string, string>,
    who: 'u1' as string | null,
    server: account,
    served: null as string | null,
  }
  const bases = new Map<string, Base>()
  const world: VaultWorld = {
    account: () => here.who,
    call: async <T>(path: string, method?: string, body?: unknown) =>
      (await here.server.answer(path, method, body as Record<string, unknown>)) as T,
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
    served: () => here.served,
    serve: (id) => {
      here.served = id
    },
    drop: (gone) => {
      const ids = new Set(gone.map((one) => one.id))
      here.accounts = gone.reduce((state, one) => removed(state, one.id), here.accounts)
      here.keys = Object.fromEntries(Object.entries(here.keys).filter(([id]) => !ids.has(id)))
      return Promise.resolve()
    },
  }
  return { vault: new Vault(world), here, world }
}
const keyed = added(NONE, 'anthropic').state
type Device = ReturnType<typeof device>
async function opened(keys = true) {
  const account = new Account()
  const laptop = device(account, keyed)
  if (keys) laptop.here.keys = { anthropic: 'sk-ant-secret' }
  await laptop.vault.refresh()
  return { account, laptop }
}
describe('a device signed in to the account', () => {
  test('keeps its AI accounts and keys with the account at once', async () => {
    const { account, laptop } = await opened()
    expect(laptop.vault.standing).toBe('open')
    expect(account.held().keys).toEqual({ anthropic: 'sk-ant-secret' })
  })
  test('new to the account has its AI accounts and keys on its first look, with nothing asked of another device', async () => {
    const { account } = await opened()
    const phone = device(account)
    await phone.vault.refresh()
    expect(phone.vault.standing).toBe('open')
    expect(phone.here.keys).toEqual({ anthropic: 'sk-ant-secret' })
    expect(phone.here.accounts.accounts.map((one) => one.id)).toEqual(['anthropic'])
  })
  test('brings what only it held the first time, and takes what the account holds', async () => {
    const { account, laptop } = await opened()
    const phone = device(account, added(NONE, 'openai').state)
    phone.here.keys = { openai: 'sk-only-on-the-phone' }
    await phone.vault.refresh()
    await laptop.vault.refresh()
    const both = { anthropic: 'sk-ant-secret', openai: 'sk-only-on-the-phone' }
    expect(phone.here.keys).toEqual(both)
    expect(laptop.here.keys).toEqual(both)
  })
  test('sees a change made on another reach it', async () => {
    const { account, laptop } = await opened(false)
    const phone = device(account)
    await phone.vault.refresh()
    phone.here.keys = { anthropic: 'sk-typed-on-the-phone' }
    phone.here.accounts = added(phone.here.accounts, 'openai').state
    await phone.vault.refresh()
    await laptop.vault.refresh()
    expect(laptop.here.keys.anthropic).toBe('sk-typed-on-the-phone')
    expect(laptop.here.accounts.accounts.map((one) => one.id)).toEqual(['anthropic', 'openai'])
  })
  test('writing over another device’s write meanwhile takes it in and writes again', async () => {
    const { account, laptop } = await opened()
    const phone = device(account)
    await phone.vault.refresh()
    phone.here.accounts = added(phone.here.accounts, 'openai').state
    phone.here.keys = { ...phone.here.keys, openai: 'sk-openai' }
    const call = laptop.world.call.bind(laptop.world)
    let crossed = false
    laptop.world.call = async <T>(path: string, method?: string, body?: unknown): Promise<T> => {
      const said = await call<T>(path, method, body)
      if (!crossed && method === undefined) {
        crossed = true
        await phone.vault.refresh()
      }
      return said
    }
    laptop.here.keys = { anthropic: 'sk-ant-new' }
    await laptop.vault.refresh()
    expect(account.held().keys).toEqual({ anthropic: 'sk-ant-new', openai: 'sk-openai' })
  })
  test('with an account here under the id of a different one there moves it to a fresh id, and what was on it goes with it', async () => {
    const account = new Account()
    const router = updated(added(NONE, 'compatible').state, 'compatible-1', {
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    })
    const ollama = updated(added(NONE, 'compatible').state, 'compatible-1', {
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
    })
    const laptop = device(account, router)
    await laptop.vault.refresh()
    const phone = device(account, ollama)
    const thread = { provider: 'compatible-1' }
    const apply = phone.world.apply.bind(phone.world)
    phone.world.apply = async (contents, before, moved) => {
      thread.provider = moved[thread.provider] ?? thread.provider
      await apply(contents, before, moved)
    }
    await phone.vault.refresh()
    expect(resolve(phone.here.accounts, 'compatible-1')?.name).toBe('OpenRouter')
    expect(resolve(phone.here.accounts, thread.provider)?.name).toBe('Ollama')
  })
  test('writes nothing when nothing changed', async () => {
    const { account, laptop } = await opened()
    const writes = account.writes
    await laptop.vault.refresh()
    await laptop.vault.refresh()
    expect(account.writes).toBe(writes)
  })
})
describe('an Orden account leaving the device', () => {
  function signIn(laptop: Device, who: string, server = new Account()) {
    laptop.here.who = who
    laptop.here.server = server
    return server
  }
  test('takes the AI accounts and keys it kept off the device, and the next account never gets them', async () => {
    const { laptop } = await opened()
    laptop.vault.seen = { anthropic: 'a@example.com' }
    laptop.here.who = null
    await laptop.vault.left()
    expect(laptop.here.accounts.accounts).toEqual([])
    expect(laptop.here.keys).toEqual({})
    expect(laptop.vault.seen).toEqual({})
    const local = added(NONE, 'openai')
    laptop.here.accounts = local.state
    laptop.here.keys = { [local.account.id]: 'sk-only-here' }
    const other = signIn(laptop, 'u2')
    await laptop.vault.refresh()
    expect(laptop.vault.standing).toBe('open')
    expect(other.contents).not.toContain('sk-ant-secret')
    expect(other.contents).toContain('sk-only-here')
  })
  test('is noticed when another signs in without the first signing out, before the next account’s are read', async () => {
    const { laptop } = await opened()
    const other = signIn(laptop, 'u2')
    await laptop.vault.refresh()
    expect(laptop.here.keys).toEqual({})
    expect(other.contents ?? '').not.toContain('sk-ant-secret')
  })
  test('while the account is being read, brings nothing of it back', async () => {
    const { account, laptop } = await opened()
    const call = laptop.world.call.bind(laptop.world)
    laptop.world.call = async <T>(path: string, method?: string, body?: unknown): Promise<T> => {
      const said = await call<T>(path, method, body)
      if (method === undefined && laptop.here.who) {
        laptop.here.who = null
        await laptop.vault.left()
      }
      return said
    }
    const rev = account.rev
    await laptop.vault.refresh()
    expect(laptop.here.keys).toEqual({})
    expect(laptop.here.accounts.accounts).toEqual([])
    expect(account.rev).toBe(rev)
  })
  test('finds its AI accounts again when it signs in again', async () => {
    const { account, laptop } = await opened()
    laptop.here.who = null
    await laptop.vault.left()
    signIn(laptop, 'u1', account)
    await laptop.vault.refresh()
    expect(laptop.here.keys).toEqual({ anthropic: 'sk-ant-secret' })
    expect(account.held().keys).toEqual({ anthropic: 'sk-ant-secret' })
  })
  test('deleted with its data kept here leaves the AI accounts on the device, no longer the account’s', async () => {
    const { laptop } = await opened()
    laptop.here.who = null
    await laptop.vault.left(true)
    expect(laptop.here.keys).toEqual({ anthropic: 'sk-ant-secret' })
    expect(laptop.world.loadBase('u1')).toBeNull()
    expect(laptop.world.served()).toBeNull()
  })
})
