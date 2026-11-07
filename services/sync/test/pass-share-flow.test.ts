import type { Login, Role } from '@orden/pass/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'
import {
  content,
  type Device,
  FAST,
  Flow,
  kit,
  type Kit,
  login,
  names,
  ORIGIN,
  PASSWORD,
} from './pass-flow'
import { type Person, person } from './pass-fakes'

const HOUR = 3600e3

let env: TestEnv
let k: Kit
let ada: Person
let bob: Person
let cy: Person
let flow: Flow

beforeEach(async () => {
  env = testEnv()
  k = await kit()
  ada = await person(env, 'ada@example.com')
  bob = await person(env, 'bob@example.com')
  cy = await person(env, 'cy@example.com')
  flow = new Flow(env, k, ada)
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

const apiOf = (who: Person) => flow.apiOf(who)
const synced = (device: Device, who: Person) => flow.synced(device, who)
const sharing = (device: Device, who: Person) => flow.sharing(device, who)
const deviceOf = (who: Person) => flow.deviceOf(who)
const family = () => flow.family()
const checked = (device: Device, who: Person, email: string) => flow.checked(device, who, email)
const invited = (a: Device, vault: string, email: string, role: Role) =>
  flow.invited(a, vault, email, role)
const accepted = (device: Device, who: Person, vault: string) => flow.accepted(device, who, vault)
const joined = (a: Device, vault: string, who: Person, role: Role) =>
  flow.joined(a, vault, who, role)

describe('sharing a vault', () => {
  test('with somebody who has Pass: invited, accepted, and the items open for them', async () => {
    const { a, vault, id } = await family()
    const b = await deviceOf(bob)

    expect(await invited(a, vault, 'Bob@Example.com', 'editor')).toBe('pending')
    expect(await synced(b, bob)).toBe('synced')
    const [invite] = await k.invitesOf(b.rows)
    expect(invite).toMatchObject({ vault, from: ada.email, role: 'editor' })
    expect((await k.invitedMeta(b.held!, invite!))?.name).toBe('Family')
    const bobsKey = { pub: b.held!.opened.pair.pub, signPub: b.held!.opened.signer!.pub }
    expect((await k.personFor(sharing(a, ada), bob.email)).code).toBe(await k.codeOf(bobsKey))
    expect(names(b)).not.toContain('Family')

    await accepted(b, bob, vault)
    expect(names(b)).toContain('Family')
    expect(content(b, id)).toMatchObject({ title: 'Bank', password: 'one' })
    expect(await k.invitesOf(b.rows)).toEqual([])

    const members = await apiOf(ada).members(vault)
    expect(members.map((one) => [one.email, one.role, one.state])).toEqual([
      [ada.email, 'owner', 'active'],
      [bob.email, 'editor', 'active'],
    ])
  })

  test('with somebody who has no Pass yet: pending, confirmed once they make one, then accepted', async () => {
    const { a, vault, id } = await family()
    expect(await invited(a, vault, cy.email, 'viewer')).toBe('pending')
    const waiting = async () =>
      (await apiOf(ada).members(vault)).find((one) => one.email === cy.email)
    expect(await waiting()).toMatchObject({ state: 'pending', pub: null })
    const nobody = await k.personFor(sharing(a, ada), cy.email)
    await expect(k.confirmedMember(sharing(a, ada), vault, nobody)).rejects.toThrow()

    const c = await deviceOf(cy)
    expect(await waiting()).toMatchObject({ state: 'confirm', pub: c.held!.opened.pair.pub })
    expect((await k.invitesOf(c.rows))[0]?.key).toBe(null)

    const unchecked = await k.personFor(sharing(a, ada), cy.email)
    await expect(k.confirmedMember(sharing(a, ada), vault, unchecked)).rejects.toThrow()
    await k.confirmedMember(sharing(a, ada), vault, await checked(a, ada, cy.email))
    expect(await synced(c, cy)).toBe('synced')
    const [invite] = await k.invitesOf(c.rows)
    expect(invite?.key).not.toBe(null)
    expect((await k.invitedMeta(c.held!, invite!))?.name).toBe('Family')

    await accepted(c, cy, vault)
    expect(content(c, id).title).toBe('Bank')
    expect(c.vaults.find((one) => one.name === 'Family')?.role).toBe('viewer')
  })

  test('declined, it goes away', async () => {
    const { a, vault } = await family()
    const b = await deviceOf(bob)
    await invited(a, vault, bob.email, 'editor')
    await apiOf(bob).decline(vault)
    expect(await synced(b, bob)).toBe('synced')
    expect(await k.invitesOf(b.rows)).toEqual([])
    expect((await apiOf(ada).members(vault)).map((one) => one.email)).toEqual([ada.email])
  })

  test('to a viewer, who reads and whose writes the account refuses', async () => {
    const { a, vault, id } = await family()
    const b = await joined(a, vault, bob, 'viewer')
    expect(content(b, id).password).toBe('one')

    const mine = await b.create(vault, login('Sneaky'))
    expect(await synced(b, bob)).toBe('synced')
    expect(b.pending()).toHaveLength(1)
    expect(await synced(a, ada)).toBe('synced')
    expect(a.items.map((one) => one.id)).not.toContain(mine)

    const [row] = await apiOf(ada).allVaultItems(vault)
    const answer = await apiOf(bob).putItem(vault, id, {
      rev: row!.rev,
      key: row!.key,
      body: row!.body,
      keyVersion: row!.keyVersion,
    })
    expect(answer).toMatchObject({ ok: false, status: 403 })
  })

  test('roles change, and the change reaches the member', async () => {
    const { a, vault } = await family()
    const b = await joined(a, vault, bob, 'editor')
    await apiOf(ada).setRole(vault, bob.email, 'viewer')
    expect(await synced(b, bob)).toBe('synced')
    expect(b.vaults.find((one) => one.name === 'Family')?.role).toBe('viewer')
    await expect(apiOf(bob).setRole(vault, ada.email, 'viewer')).rejects.toThrow()
  })
})

describe('removing a member', () => {
  test('renews the vault key, so what is written after cannot be opened with the old one', async () => {
    const { a, vault, id } = await family()
    const b = await joined(a, vault, bob, 'editor')
    const c = await joined(a, vault, cy, 'editor')
    const old = b.held!.vaults.get(vault)!.key

    await a.change(id, (one) => ({
      ...one,
      content: { ...one.content, password: 'two' } as Login,
      modified: Date.now(),
    }))
    expect(await synced(a, ada)).toBe('synced')
    await a.change(id, (one) => ({
      ...one,
      content: { ...one.content, note: 'unsent' },
      modified: Date.now(),
    }))
    expect(a.rows.versionRows.length).toBeGreaterThan(0)

    expect(await k.removedMember(sharing(a, ada), vault, bob.email)).toBe(2)
    const box = a.held!.vaults.get(vault)!
    expect(box.row.keyVersion).toBe(2)
    for (const version of a.rows.versionRows.filter((one) => one.vault === vault)) {
      const { id: at, rev, key, body } = version
      const opened = await k.openVersion(box.key, vault, at, rev, key, body)
      expect(opened.envelope.content.title).toBe('Bank')
    }

    const fresh = await a.create(vault, login('After', { password: 'new' }))
    expect(await synced(a, ada)).toBe('synced')
    expect(a.pending()).toEqual([])

    const rows = await apiOf(ada).allVaultItems(vault)
    expect(rows.every((one) => one.keyVersion === 2)).toBe(true)
    const after = rows.find((one) => one.id === fresh)!
    await expect(
      k.openItem(old, vault, fresh, after.key, after.body, after.keyVersion),
    ).rejects.toThrow()

    expect(await synced(b, bob)).toBe('synced')
    expect(names(b)).not.toContain('Family')
    expect(b.items.map((one) => one.id)).not.toContain(id)
    await expect(apiOf(bob).allVaultItems(vault)).rejects.toThrow()

    expect(await synced(c, cy)).toBe('synced')
    expect(content(c, fresh).password).toBe('new')
    expect(content(c, id)).toMatchObject({ password: 'two', note: 'unsent' })

    const again = new k.TestDevice(FAST)
    expect(await synced(again, ada)).toBe('synced')
    expect(await again.unlock(PASSWORD)).toBe(true)
    expect(await synced(again, ada)).toBe('synced')
    expect(content(again, fresh).title).toBe('After')
    expect(content(again, id).note).toBe('unsent')
  })

  test('also renews the key of an invitation still waiting, which keeps working', async () => {
    const { a, vault, id } = await family()
    const b = await joined(a, vault, bob, 'editor')
    const c = await deviceOf(cy)
    await invited(a, vault, cy.email, 'viewer')

    await k.removedMember(sharing(a, ada), vault, bob.email)
    expect(await synced(b, bob)).toBe('synced')
    expect(await synced(c, cy)).toBe('synced')
    const [invite] = await k.invitesOf(c.rows)
    expect((await k.invitedMeta(c.held!, invite!))?.name).toBe('Family')
    await accepted(c, cy, vault)
    expect(content(c, id).title).toBe('Bank')
  })
})

describe('a member’s history after the key is renewed', () => {
  async function edited(a: Device, id: string, password: string) {
    await a.change(id, (one) => ({
      ...one,
      content: { ...one.content, password } as Login,
      modified: Date.now(),
    }))
    expect(await synced(a, ada)).toBe('synced')
  }

  async function historyOf(device: Device, vault: string, id: string): Promise<string[]> {
    const box = device.held!.vaults.get(vault)!
    const passwords: string[] = []
    for (const version of device.rows.versionRows.filter(
      (one) => one.vault === vault && one.id === id,
    )) {
      const opened = await k.openVersion(box.key, vault, id, version.rev, version.key, version.body)
      passwords.push((opened.envelope.content as Login).password)
    }
    return passwords.sort()
  }

  async function renewed() {
    const { a, vault, id } = await family()
    const b = await joined(a, vault, bob, 'editor')
    await joined(a, vault, cy, 'editor')
    await edited(a, id, 'two')
    expect(await synced(b, bob)).toBe('synced')
    expect(await historyOf(b, vault, id)).toEqual(['one'])
    await edited(a, id, 'three')
    return { a, b, vault, id }
  }

  test('still opens on another member’s device under the new key', async () => {
    const { a, b, vault, id } = await renewed()
    expect(await k.removedMember(sharing(a, ada), vault, cy.email)).toBe(2)

    expect(await synced(b, bob)).toBe('synced')
    expect(b.held!.vaults.get(vault)!.row.keyVersion).toBe(2)
    expect(content(b, id).password).toBe('three')
    expect(await historyOf(b, vault, id)).toEqual(['one', 'two'])
  })

  test('waits while that device is locked, and opens once it is unlocked', async () => {
    const { a, b, vault, id } = await renewed()
    b.lock()
    expect(await k.removedMember(sharing(a, ada), vault, cy.email)).toBe(2)

    expect(await synced(b, bob)).toBe('synced')
    expect(await b.unlock(PASSWORD)).toBe(true)
    expect(await historyOf(b, vault, id)).toEqual(['one'])
    expect(await synced(b, bob)).toBe('synced')
    expect(b.held!.vaults.get(vault)!.row.keyVersion).toBe(2)
    expect(await historyOf(b, vault, id)).toEqual(['one', 'two'])
  })
})

describe('handing a vault on and leaving it', () => {
  test('the new owner owns it, the old one manages it and may leave', async () => {
    const { a, vault, id } = await family()
    const b = await joined(a, vault, bob, 'editor')
    await expect(apiOf(ada).removeMember(vault, ada.email)).rejects.toThrow()

    await k.handedOn(sharing(a, ada), vault, bob.email)
    expect(await synced(a, ada)).toBe('synced')
    expect(await synced(b, bob)).toBe('synced')
    expect(a.vaults.find((one) => one.name === 'Family')?.role).toBe('manager')
    expect(b.vaults.find((one) => one.name === 'Family')?.role).toBe('owner')
    await expect(apiOf(bob).removeMember(vault, bob.email)).rejects.toThrow()

    await apiOf(ada).removeMember(vault, ada.email)
    expect(await synced(a, ada)).toBe('synced')
    expect(names(a)).not.toContain('Family')
    expect(a.items.map((one) => one.id)).not.toContain(id)
    expect((await apiOf(bob).members(vault)).map((one) => one.email)).toEqual([bob.email])
  })
})

describe('a secure link', () => {
  async function linked(views: number | null, expires = HOUR) {
    const a = new k.TestDevice(FAST)
    const personal = await a.setup(PASSWORD)
    const id = await a.create(
      personal,
      login('Wifi box', {
        password: 'hunter2',
        passkeys: [
          {
            id: 'pk1',
            rpId: 'example.com',
            rpName: 'Example',
            userName: 'ada',
            userDisplayName: 'Ada',
            userHandle: 'aGFuZGxl',
            credentialId: 'Y3JlZA',
            privateKey: 'PRIVATE-PASSKEY-SECRET',
            algorithm: -7,
            counter: 0,
            created: 1,
            note: '',
          },
        ],
      }),
    )
    expect(await synced(a, ada)).toBe('synced')
    flow.seen.length = 0
    const made = await k.madeLink(apiOf(ada), ORIGIN, a.item(id), { expires, views })
    return { a, id, made }
  }

  const opened = (id: string) =>
    call<{ body?: string; expires?: number; left?: number | null; error?: string }>(
      env,
      `/v1/pass-link/${id}`,
    )

  test('opens to anybody with the whole address, without its passkeys’ private keys', async () => {
    const { a, id, made } = await linked(null)
    const url = new URL(made.url)
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe(`/pass-link/${made.link.id}`)
    expect(made.link.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(url.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/)

    const secret = url.hash.slice(1)
    for (const request of flow.seen) {
      expect(request.url).not.toContain('#')
      const text = await request.text()
      expect(text).not.toContain(secret)
      expect(text).not.toContain('hunter2')
      expect(text).not.toContain('PRIVATE-PASSKEY-SECRET')
    }

    const answer = await opened(made.link.id)
    expect(answer.status).toBe(200)
    expect(answer.json.left).toBe(null)
    const key = k.linkKeyIn(url.hash)!
    const shown = (await k.openedLink(key, made.link.id, answer.json.body!)) as Login
    expect(shown).toEqual(k.sharedContent(a.item(id).content))
    expect(shown.password).toBe('hunter2')
    expect(shown.passkeys[0]?.privateKey).toBe('')
    expect(JSON.stringify(shown)).not.toContain('PRIVATE-PASSKEY-SECRET')

    const wrong = new Uint8Array(32)
    expect(await k.openedLink(wrong, made.link.id, answer.json.body!)).toBe(null)
  })

  test('stops opening once its views are used up', async () => {
    const { made } = await linked(2)
    expect((await opened(made.link.id)).json.left).toBe(1)
    expect((await opened(made.link.id)).json.left).toBe(0)
    expect((await opened(made.link.id)).status).toBe(410)
    const [listed] = await apiOf(ada).links()
    expect(listed).toMatchObject({ id: made.link.id, views: 2, seen: 2 })
  })

  test('stops opening once it expires, and is swept with the others', async () => {
    const { made } = await linked(null, HOUR)
    expect((await opened(made.link.id)).status).toBe(200)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 2 * HOUR)
    expect((await opened(made.link.id)).status).toBe(410)
    expect(await apiOf(ada).removeExpired()).toBe(1)
    expect(await apiOf(ada).links()).toEqual([])
    expect((await opened(made.link.id)).status).toBe(404)
  })

  test('deleted, is gone', async () => {
    const { made } = await linked(5)
    await apiOf(ada).removeLink(made.link.id)
    expect(await apiOf(ada).links()).toEqual([])
    expect((await opened(made.link.id)).status).toBe(404)
  })
})

describe('the page a secure link opens', () => {
  test('is served at /pass-link/<id> with a policy that lets nothing else in', async () => {
    const page = testEnv({
      ASSETS: {
        fetch: (request: Request) =>
          Promise.resolve(
            new Response(new URL(request.url).pathname, {
              headers: { 'content-type': 'text/html' },
            }),
          ),
      },
    })
    const answer = await call(page, '/pass-link/AAAAAAAAAAAAAAAAAAAAAA')
    expect(answer.text).toBe('/pass-link.html')
    const policy = answer.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).not.toContain('unsafe')
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    page.close()
  })

  test('is served on the app’s own hosts only, never on a blog’s', async () => {
    const page = testEnv({
      ASSETS: {
        fetch: (request: Request) =>
          Promise.resolve(
            new Response(new URL(request.url).pathname, {
              headers: { 'content-type': 'text/html' },
            }),
          ),
      },
    })
    const path = '/pass-link/AAAAAAAAAAAAAAAAAAAAAA'
    expect((await call(page, path, { host: 'orden.so' })).text).toBe('/pass-link.html')
    for (const host of ['ada.orden.so', 'blog.example.com']) {
      const elsewhere = await call(page, path, { host })
      expect(elsewhere.text, host).not.toBe('/pass-link.html')
      expect(elsewhere.headers.get('content-security-policy') ?? '', host).not.toContain(
        "default-src 'none'",
      )
    }
    page.close()
  })
})
