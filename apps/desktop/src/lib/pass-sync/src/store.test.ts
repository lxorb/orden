import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import { openExport } from '@orden/pass/export'
import { parseOrden } from '@orden/pass/import/orden'
import type { Login, Website } from '@orden/pass/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { forgetLocal } from './local'
import { configurePass, PassStore } from './store.svelte'

const fake = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  guarded: true,
  can: true,
  yes: true,
  asked: [] as string[],
}))

vi.mock('../../ai/keys', () => ({
  keysAreGuarded: () => fake.guarded,
  readSecret: (id: string) => Promise.resolve(fake.secrets.get(id) ?? null),
  writeSecret: (id: string, secret: string) => {
    fake.secrets.set(id, secret)
    return Promise.resolve()
  },
  forgetKey: (id: string) => {
    fake.secrets.delete(id)
    return Promise.resolve()
  },
}))

vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(fake.can),
  deviceSays: (reason: string) => {
    fake.asked.push(reason)
    return Promise.resolve(fake.yes)
  },
  deviceName: () => 'Touch ID',
}))

const FAST = { m: 64, t: 1, p: 1 }
const PASSWORD = 'correct horse battery staple'
const SECRET = 'hunter2-very-secret'
const TITLE = 'Secret Bank Title'

configurePass({ kdf: FAST, pinKdf: FAST })

function login(title: string, more: Partial<Login> = {}): Login {
  return { ...blank('login'), title, ...more }
}

function site(url: string, match: Website['match'] = 'domain'): Website {
  return { url, match }
}

async function started(): Promise<PassStore> {
  const store = new PassStore()
  await store.start()
  return store
}

async function fresh(): Promise<{ store: PassStore; recovery: string }> {
  const store = await started()
  expect(store.state).toBe('new')
  const recovery = await store.setup(PASSWORD)
  return { store, recovery }
}

async function reopened(): Promise<PassStore> {
  const store = await started()
  expect(store.state).toBe('locked')
  expect(await store.unlock({ password: PASSWORD })).toBe(true)
  return store
}

function personal(store: PassStore): string {
  const vault = store.vaults[0]
  if (!vault) throw new Error('no vault')
  return vault.id
}

function request<T>(asked: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    asked.onsuccess = () => resolve(asked.result)
    asked.onerror = () => reject(asked.error ?? new Error('failed'))
  })
}

async function everythingKept(): Promise<string> {
  const db = await request(indexedDB.open('orden-pass'))
  const rows: unknown[] = []
  for (const name of Array.from(db.objectStoreNames)) {
    rows.push(...(await request(db.transaction(name).objectStore(name).getAll())))
  }
  db.close()
  return JSON.stringify(rows)
}

beforeEach(async () => {
  await forgetLocal()
  fake.secrets.clear()
  fake.guarded = true
  fake.can = true
  fake.yes = true
  fake.asked = []
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
    removeItem: (key: string) => kept.delete(key),
  })
})

describe('setting up and unlocking', () => {
  test('a first setup opens Pass with one vault, Personal, and a recovery code', async () => {
    const { store, recovery } = await fresh()
    expect(store.state).toBe('open')
    expect(recovery).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/)
    expect(store.vaults).toHaveLength(1)
    expect(store.vaults[0]).toMatchObject({ name: 'Personal', color: 'purple', icon: 'home' })
    expect(store.vaults[0]?.role).toBe('owner')
  })

  test('locking empties everything, and the password opens it again', async () => {
    const { store } = await fresh()
    await store.create(personal(store), login('Mail'))
    store.lock()
    expect(store.state).toBe('locked')
    expect(store.items).toEqual([])
    expect(store.vaults).toEqual([])
    await expect(store.create('x', login('No'))).rejects.toThrow(/locked/)
    expect(await store.unlock({ password: PASSWORD })).toBe(true)
    expect(store.items.map((item) => item.content.title)).toEqual(['Mail'])
  })

  test('a wrong password answers false and throws nothing', async () => {
    const { store } = await fresh()
    store.lock()
    expect(await store.unlock({ password: 'nope' })).toBe(false)
    expect(store.state).toBe('locked')
    expect(store.error).toBeNull()
  })

  test('the recovery code opens it and asks for a new password', async () => {
    const { store, recovery } = await fresh()
    store.lock()
    expect(await store.unlock({ recovery: 'AAAA-BBBB' })).toBe(false)
    expect(await store.unlock({ recovery })).toBe(true)
    expect(store.mustChangePassword).toBe(true)
    expect(await store.changePassword('', 'a new password')).toBe(true)
    expect(store.mustChangePassword).toBe(false)
    store.lock()
    expect(await store.unlock({ password: PASSWORD })).toBe(false)
    expect(await store.unlock({ password: 'a new password' })).toBe(true)
    expect(store.mustChangePassword).toBe(false)
  })

  test('a password is changed only with the old one', async () => {
    const { store } = await fresh()
    expect(await store.changePassword('wrong', 'other')).toBe(false)
    expect(await store.changePassword(PASSWORD, 'other')).toBe(true)
    expect(await store.confirmPassword('other')).toBe(true)
    expect(await store.confirmPassword(PASSWORD)).toBe(false)
  })

  test('a new recovery code replaces the old one', async () => {
    const { store, recovery } = await fresh()
    expect(await store.newRecovery('wrong')).toBeNull()
    const next = await store.newRecovery(PASSWORD)
    expect(next).not.toBeNull()
    expect(next).not.toBe(recovery)
    store.lock()
    expect(await store.unlock({ recovery })).toBe(false)
    expect(await store.unlock({ recovery: next ?? '' })).toBe(true)
  })
})

describe('the PIN', () => {
  test('opens Pass, and survives a restart', async () => {
    const { store } = await fresh()
    expect(store.canPin).toBe(true)
    expect(await store.useLock('pin', '12')).toBe(false)
    expect(await store.useLock('pin', '1234')).toBe(true)
    expect(store.settings.lock).toBe('pin')
    expect(fake.secrets.get('pass-device')).toBeTruthy()
    store.lock()
    expect(await store.unlock({ pin: '1234' })).toBe(true)
    const again = await started()
    expect(again.settings.lock).toBe('pin')
    expect(await again.unlock({ pin: '1234' })).toBe(true)
  })

  test('five wrong PINs forget it, and only the password opens Pass then', async () => {
    const { store } = await fresh()
    await store.useLock('pin', '1234')
    store.lock()
    for (let left = 4; left >= 1; left--) {
      expect(await store.unlock({ pin: '0000' })).toBe(false)
      expect(store.pinTries).toBe(left)
    }
    expect((await started()).pinTries).toBe(1)
    expect(await store.unlock({ pin: '0000' })).toBe(false)
    expect(store.pinTries).toBe(0)
    expect(store.settings.lock).toBe('password')
    expect(await store.unlock({ pin: '1234' })).toBe(false)
    expect(await store.unlock({ password: PASSWORD })).toBe(true)
  })

  test('the right PIN after wrong ones starts the count again', async () => {
    const { store } = await fresh()
    await store.useLock('pin', '1234')
    store.lock()
    await store.unlock({ pin: '9999' })
    await store.unlock({ pin: '9999' })
    expect(store.pinTries).toBe(3)
    expect(await store.unlock({ pin: '1234' })).toBe(true)
    expect(store.pinTries).toBe(5)
  })

  test('wrong PINs typed at once count once each, in one window or in two', async () => {
    const { store } = await fresh()
    await store.useLock('pin', '1234')
    store.lock()
    const other = await started()
    const tried = await Promise.all([
      store.unlock({ pin: '0000' }),
      store.unlock({ pin: '1111' }),
      other.unlock({ pin: '2222' }),
      other.unlock({ pin: '3333' }),
    ])
    expect(tried).toEqual([false, false, false, false])
    expect((await started()).pinTries).toBe(1)
    await Promise.all([store.unlock({ pin: '4444' }), other.unlock({ pin: '5555' })])
    const after = await started()
    expect(after.settings.lock).toBe('password')
    expect(after.pinTries).toBe(5)
    expect(await after.unlock({ pin: '1234' })).toBe(false)
    expect(await after.unlock({ password: PASSWORD })).toBe(true)
  })

  test('going back to the password forgets this device’s seal', async () => {
    const { store } = await fresh()
    await store.useLock('pin', '1234')
    expect(await store.useLock('password')).toBe(true)
    expect(store.settings.lock).toBe('password')
    store.lock()
    expect(await store.unlock({ pin: '1234' })).toBe(false)
  })

  test('the browser build offers the password only', async () => {
    fake.guarded = false
    const { store } = await fresh()
    expect(store.canPin).toBe(false)
    expect(store.canDevice).toBe(false)
    expect(await store.useLock('pin', '1234')).toBe(false)
    expect(await store.useLock('device')).toBe(false)
    expect(store.settings.lock).toBe('password')
  })
})

describe('the device', () => {
  test('opens Pass when the system says yes, and not when it says no', async () => {
    const { store } = await fresh()
    expect(store.canDevice).toBe(true)
    expect(await store.useLock('device')).toBe(true)
    expect(store.settings.lock).toBe('device')
    store.lock()
    fake.yes = false
    expect(await store.unlock({ device: true })).toBe(false)
    expect(store.state).toBe('locked')
    fake.yes = true
    expect(await store.unlock({ device: true })).toBe(true)
    expect(fake.asked).toContain('Unlock Pass')
  })

  test('cannot be chosen where the system cannot ask', async () => {
    fake.can = false
    const { store } = await fresh()
    expect(store.canDevice).toBe(false)
    expect(await store.useLock('device')).toBe(false)
  })
})

describe('items', () => {
  test('are written, changed and still there after a restart', async () => {
    const { store } = await fresh()
    const vault = personal(store)
    const made = await store.create(vault, login('Mail', { password: 'one' }))
    expect(made.rev).toBe(1)
    const changed = await store.update(made.id, login('Mail', { password: 'two' }))
    expect(changed.rev).toBe(2)
    await store.create(vault, { ...blank('note'), title: 'Diary', note: 'dear' })
    const again = await reopened()
    expect(again.items).toHaveLength(2)
    const mail = again.items.find((item) => item.id === made.id)
    expect(mail?.content).toMatchObject({ title: 'Mail', password: 'two' })
    expect(mail?.rev).toBe(2)
  })

  test('go to the trash, come back, and go for good', async () => {
    const { store } = await fresh()
    const vault = personal(store)
    const a = await store.create(vault, login('A'))
    const b = await store.create(vault, login('B'))
    const c = await store.create(vault, login('C'))
    await store.trash([a.id, b.id])
    expect(store.items.filter((item) => item.trashed !== null)).toHaveLength(2)
    await store.restore([b.id])
    expect(store.items.find((item) => item.id === b.id)?.trashed).toBeNull()
    await store.remove([c.id])
    expect(store.items.map((item) => item.id).sort()).toEqual([a.id, b.id].sort())
    await store.emptyTrash()
    expect(store.items.map((item) => item.id)).toEqual([b.id])
    expect((await reopened()).items.map((item) => item.id)).toEqual([b.id])
  })

  test('move to another vault, with their history', async () => {
    const { store } = await fresh()
    const home = personal(store)
    const work = await store.createVault({ name: 'Work', color: 'blue', icon: 'work' })
    const made = await store.create(home, login('Wiki'))
    await store.update(made.id, login('Wiki 2'))
    await store.move([made.id], work.id)
    expect(store.items).toHaveLength(1)
    expect(store.items[0]?.vault).toBe(work.id)
    expect((await store.history(made.id)).map((item) => item.content.title)).toEqual(['Wiki'])
    await store.update(made.id, login('Wiki 3'))
    const again = await reopened()
    expect(again.items).toHaveLength(1)
    expect(again.items[0]).toMatchObject({ vault: work.id, content: { title: 'Wiki 3' } })
    expect((await again.history(made.id)).map((item) => item.content.title)).toEqual([
      'Wiki 2',
      'Wiki',
    ])
  })

  test('move all from one vault, and a deleted vault takes its items', async () => {
    const { store } = await fresh()
    const home = personal(store)
    const work = await store.createVault({ name: 'Work' })
    await store.create(home, login('A'))
    await store.create(home, login('B'))
    await store.moveAll(home, work.id)
    expect(store.items.every((item) => item.vault === work.id)).toBe(true)
    await store.deleteVault(work.id)
    expect(store.vaults.map((vault) => vault.id)).toEqual([home])
    expect(store.items).toEqual([])
    await expect(store.deleteVault(home)).rejects.toThrow(/last vault/)
    expect((await reopened()).vaults.map((vault) => vault.name)).toEqual(['Personal'])
  })

  test('a vault is renamed and its folders kept', async () => {
    const { store } = await fresh()
    const home = personal(store)
    await store.updateVault(home, {
      name: 'Home',
      folders: [{ id: 'f1', name: 'Banks', parent: null }],
    })
    const again = await reopened()
    expect(again.vaults[0]).toMatchObject({ name: 'Home', color: 'purple', rev: 2 })
    expect(again.vaults[0]?.folders).toEqual([{ id: 'f1', name: 'Banks', parent: null }])
  })

  test('duplicate makes a copy with its own id', async () => {
    const { store } = await fresh()
    const made = await store.create(personal(store), login('Mail', { password: 'p' }))
    const copy = await store.duplicate(made.id)
    expect(copy.id).not.toBe(made.id)
    expect(copy.content).toMatchObject({ title: 'Copy of Mail', password: 'p' })
    expect(store.items).toHaveLength(2)
  })

  test('pin, monitor and used change the flags and leave no history', async () => {
    const { store } = await fresh()
    const made = await store.create(personal(store), login('Mail'))
    await store.pin(made.id, true)
    await store.monitor(made.id, false)
    await store.used(made.id)
    const item = store.items[0]
    expect(item).toMatchObject({ pinned: true, monitored: false })
    expect(item?.used).toBeTypeOf('number')
    expect(await store.history(made.id)).toEqual([])
    const again = await reopened()
    expect(again.items[0]).toMatchObject({ pinned: true, monitored: false })
  })

  test('history keeps older versions, newest first, and one comes back', async () => {
    const { store } = await fresh()
    const made = await store.create(personal(store), login('One'))
    await store.update(made.id, login('Two'))
    await store.update(made.id, login('Three'))
    const versions = await store.history(made.id)
    expect(versions.map((item) => [item.rev, item.content.title])).toEqual([
      [2, 'Two'],
      [1, 'One'],
    ])
    const back = await store.restoreVersion(made.id, 1)
    expect(back.content.title).toBe('One')
    expect(back.rev).toBe(4)
    expect((await store.history(made.id)).map((item) => item.content.title)).toEqual([
      'Three',
      'Two',
      'One',
    ])
    await store.clearHistory(made.id)
    expect(await store.history(made.id)).toEqual([])
  })

  test('history keeps at most thirty versions', async () => {
    const { store } = await fresh()
    const made = await store.create(personal(store), login('v0'))
    for (let at = 1; at <= 33; at++) await store.update(made.id, login(`v${String(at)}`))
    const versions = await store.history(made.id)
    expect(versions).toHaveLength(30)
    expect(versions[0]?.content.title).toBe('v32')
    expect(versions.at(-1)?.content.title).toBe('v3')
  })
})

describe('matching a page', () => {
  test('is the active logins whose websites match, best rule first, then most used', async () => {
    const { store } = await fresh()
    const vault = personal(store)
    const domain = await store.create(vault, login('Domain', { websites: [site('example.com')] }))
    const recent = await store.create(vault, login('Recent', { websites: [site('example.com')] }))
    const host = await store.create(
      vault,
      login('Host', { websites: [site('https://login.example.com', 'host')] }),
    )
    const exact = await store.create(
      vault,
      login('Exact', { websites: [site('https://login.example.com/signin', 'exact')] }),
    )
    await store.create(vault, login('Other', { websites: [site('other.com')] }))
    const trashed = await store.create(vault, login('Trashed', { websites: [site('example.com')] }))
    await store.create(vault, { ...blank('note'), title: 'example.com' })
    await store.trash([trashed.id])
    await store.used(domain.id)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.used(recent.id)
    const found = store.matching('https://login.example.com/signin')
    expect(found.map((item) => item.id)).toEqual([exact.id, host.id, recent.id, domain.id])
    expect(store.matching('https://nothing.org')).toEqual([])
  })
})

describe('import and export', () => {
  test('what is exported comes back in', async () => {
    const { store } = await fresh()
    const home = personal(store)
    await store.updateVault(home, { folders: [{ id: 'f1', name: 'Banks', parent: null }] })
    await store.create(home, login('Bank', { password: SECRET }), 'f1')
    const card = await store.create(home, { ...blank('card'), title: 'Visa', number: '4111' })
    await store.pin(card.id, true)
    expect(await store.exportAll('wrong', 'json')).toBeNull()
    const exported = await store.exportAll(PASSWORD, 'json')
    expect(exported?.name).toMatch(/^orden-pass-\d{4}-\d{2}-\d{2}\.json$/)
    const { added } = await store.importItems(parseOrden(exported?.text ?? ''), 'new')
    expect(added).toBe(2)
    expect(store.vaults.map((vault) => vault.name)).toEqual(['Personal', 'Personal'])
    const into = store.vaults[1]
    const imported = store.items.filter((item) => item.vault === into?.id)
    expect(imported.map((item) => item.content.title).sort()).toEqual(['Bank', 'Visa'])
    expect(imported.find((item) => item.content.title === 'Visa')?.pinned).toBe(true)
    const bank = imported.find((item) => item.content.title === 'Bank')
    expect(bank?.content).toMatchObject({ password: SECRET })
    expect(into?.folders.find((folder) => folder.id === bank?.folder)?.name).toBe('Banks')
  })

  test('an import into a vault adds to it', async () => {
    const { store } = await fresh()
    const home = personal(store)
    const { added } = await store.importItems(
      {
        vaults: [
          {
            name: 'Elsewhere',
            items: [
              {
                content: login('In'),
                created: 5,
                modified: 6,
                pinned: false,
                trashed: true,
                folder: 'Work/Old',
              },
            ],
          },
        ],
        skipped: [],
      },
      home,
    )
    expect(added).toBe(1)
    expect(store.vaults).toHaveLength(1)
    const item = store.items[0]
    expect(item).toMatchObject({ vault: home, created: 5, modified: 6 })
    expect(item?.trashed).toBeTypeOf('number')
    const folders = store.vaults[0]?.folders ?? []
    const old = folders.find((folder) => folder.id === item?.folder)
    expect(old?.name).toBe('Old')
    expect(folders.find((folder) => folder.id === old?.parent)?.name).toBe('Work')
  })

  test('sealed and CSV exports', async () => {
    const { store } = await fresh()
    await store.create(personal(store), login('Bank', { password: SECRET }))
    const sealed = await store.exportAll(PASSWORD, 'sealed', 'a passphrase')
    expect(sealed?.text).not.toContain(SECRET)
    const opened = JSON.parse(await openExport(sealed?.text ?? '', 'a passphrase')) as {
      format: string
    }
    expect(opened.format).toBe('orden-pass')
    const csv = await store.exportAll(PASSWORD, 'csv')
    expect(csv?.name).toMatch(/\.csv$/)
    expect(csv?.text.split('\n')[0]).toContain('password')
    expect(csv?.text).toContain(SECRET)
  })
})

describe('what this device keeps', () => {
  test('holds no secret and no title in the clear', async () => {
    const { store } = await fresh()
    const vault = personal(store)
    await store.updateVault(vault, { name: 'Hidden Vault Name' })
    const made = await store.create(vault, login(TITLE, { password: SECRET }))
    await store.update(made.id, login(TITLE, { password: `${SECRET}!` }))
    await store.setHibpKey('hibp-key-value')
    await store.useLock('pin', '424242')
    const kept = await everythingKept()
    for (const plain of [PASSWORD, SECRET, TITLE, 'Hidden Vault Name', 'hibp-key-value', '424242'])
      expect(kept).not.toContain(plain)
    expect(kept).toContain('"pending":true')
  })

  test('the HIBP key is kept sealed and read back after a restart', async () => {
    const { store } = await fresh()
    expect(await store.hibpKey()).toBe('')
    await store.setHibpKey('  abc  ')
    expect(await (await reopened()).hibpKey()).toBe('abc')
    await store.setHibpKey('')
    expect(await store.hibpKey()).toBe('')
  })

  test('settings are kept and read back', async () => {
    const { store } = await fresh()
    expect(store.settings.relockAfter).toBe(10)
    expect(store.settings.clipboardClear).toBe(60)
    expect(store.settings.autoLogin).toBe(false)
    store.setSetting('relockAfter', 5)
    store.setSetting('autoLogin', true)
    const again = await started()
    expect(again.settings).toMatchObject({ relockAfter: 5, autoLogin: true, autofill: true })
  })
})
