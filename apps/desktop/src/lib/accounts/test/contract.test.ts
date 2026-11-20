import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  account,
  AccountOwed,
  api,
  ApiError,
  called,
  clearsAt,
  faceUrl,
  farApart,
  fromServer,
  heardSettings,
  readSeats,
  stands,
} from '../src/api'
import { clampOffset, sourceSquare, zoomed } from '../src/crop'
import { withoutMetadata } from '../src/encode'
import { readPerson } from '../src/read'

const SRC = join(import.meta.dirname, '../src')
describe('the module stands on its own', () => {
  test('nothing under src reaches the sign-in sheet, the profile views or the sync engine', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .filter((name) => /accounts-ui|sync-client/.test(readFileSync(join(SRC, name), 'utf8')))
    expect(reaching).toEqual([])
  })
  test('loads signed out: no token, nobody, no spaces', () => {
    expect(account.signedIn).toBe(false)
    expect(account.accountToken).toBeNull()
    expect(account.name).toBeNull()
    expect(account.spaces).toEqual([])
  })
})
describe('a person', () => {
  test('is called by the name chosen, else by the part of the address before the @', () => {
    expect(called({ name: ' Ada ', email: 'ada@example.org' })).toBe('Ada')
    expect(called({ name: null, email: 'ada@example.org' })).toBe('ada')
    expect(called({ name: '', email: 'nobody' })).toBe('nobody')
  })
  test('is read from the server with only the fields that are shaped right', () => {
    const hash = 'a'.repeat(64)
    const read = readPerson({
      id: 'u1',
      name: 'Ada',
      avatar: { s: hash, l: hash },
      pronouns: 7,
      status: { emoji: 'x', text: 'away', until: 'soon' },
      presence: 'busy',
    })
    expect(read).toEqual({
      id: 'u1',
      name: 'Ada',
      avatar: { s: hash, l: hash },
      pronouns: null,
      bio: null,
      status: { emoji: 'x', text: 'away', until: null, quiet: false },
      zone: null,
      presence: 'offline',
    })
    expect(readPerson({ id: 'u1' })).toBeNull()
    expect(readPerson({ id: 'u2', name: 'B', avatar: { s: 'short', l: hash } })?.avatar).toBeNull()
  })
  test('has a face address only for a real hash', () => {
    expect(faceUrl('b'.repeat(64))).toMatch(/\/i\/b{64}\.webp$/)
    expect(faceUrl('../etc')).toBeNull()
    expect(faceUrl(null)).toBeNull()
  })
})
describe('a status', () => {
  test('clears after the span chosen, at midnight for today, never when asked', () => {
    const noon = new Date(2026, 0, 7, 12, 0, 0)
    expect(clearsAt('30m', noon)).toBe(noon.getTime() + 30 * 60_000)
    expect(clearsAt('4h', noon)).toBe(noon.getTime() + 4 * 3_600_000)
    expect(clearsAt('today', noon)).toBe(new Date(2026, 0, 8, 0, 0, 0).getTime())
    expect(clearsAt('never', noon)).toBeNull()
  })
  test('stands while its end is ahead, or for good without one', () => {
    expect(stands({ until: 10 }, 5)).toBe(true)
    expect(stands({ until: 10 }, 10)).toBe(false)
    expect(stands({ until: null }, 10)).toBe(true)
    expect(stands(null, 10)).toBe(false)
  })
  test('two zones are far apart from an hour of difference', () => {
    const at = Date.UTC(2026, 0, 7, 12)
    expect(farApart('Europe/Zurich', 'Europe/Berlin', at)).toBe(false)
    expect(farApart('Asia/Tokyo', 'Europe/Zurich', at)).toBe(true)
    expect(farApart('Nowhere/Nothing', 'Europe/Zurich', at)).toBe(false)
  })
})
describe('a picture for a face', () => {
  test('loses its metadata by its container, and anything unknown is no picture of this app', () => {
    const jpegPlain = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])
    const jpegExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 2])
    expect(withoutMetadata(jpegPlain)).toEqual(jpegPlain)
    expect(withoutMetadata(jpegExif)).toEqual(new Uint8Array([0xff, 0xd8]))
    expect(withoutMetadata(new Uint8Array([1, 2, 3]))).toBeNull()
  })
  test('a crop stays inside the picture and zooms around the point under the pointer', () => {
    const inside = clampOffset({ x: 999, y: -999 }, 200, 100, 100, 1)
    expect(inside).toEqual({ x: 50, y: 0 })
    const zoom = zoomed({ zoom: 1, offset: { x: 0, y: 0 } }, 2, { x: 0, y: 0 }, 200, 100, 100)
    expect(zoom.zoom).toBe(2)
    const square = sourceSquare({ zoom: 1, offset: { x: 0, y: 0 } }, 200, 100, 100)
    expect(square).toEqual({ left: 50, top: 0, side: 100 })
  })
})
describe('a call to the account service', () => {
  test('a refusal from the server is one it said itself only when it carries an error', () => {
    expect(fromServer(new ApiError(401, 'no', { error: 'no' }))).toBe(true)
    expect(fromServer(new ApiError(500, 'down'))).toBe(false)
    expect(fromServer(new Error('no'))).toBe(false)
  })
})
describe('the places in a shared space', () => {
  test('are read as a whole count used out of the most it holds, and nothing else', () => {
    expect(readSeats({ used: 3, most: 10 })).toEqual({ used: 3, most: 10 })
    expect(readSeats({ used: 12, most: 10 })).toEqual({ used: 12, most: 10 })
    expect(readSeats(null)).toBeNull()
    expect(readSeats(undefined)).toBeNull()
    expect(readSeats({ used: 3 })).toBeNull()
    expect(readSeats({ used: -1, most: 10 })).toBeNull()
    expect(readSeats({ used: 1.5, most: 10 })).toBeNull()
    expect(readSeats({ used: 0, most: 0 })).toBeNull()
  })
})
describe('what a module keeps for an account', () => {
  test('is let go of when another account arrives in place, as on sign-out, and kept for the same account', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const cleared: boolean[] = []
    account.forgetWithSession((kept) => cleared.push(kept))
    const ada = { id: 'ua', email: 'ada@example.org', name: 'Ada' }
    await account.arrive('first', { user: ada })
    await account.arrive('again', { user: ada })
    expect(cleared).toEqual([])
    await account.arrive('other', { user: { id: 'ub', email: 'bo@example.org', name: 'Bo' } })
    expect(cleared).toEqual([false])
    await account.signOut()
    expect(cleared).toEqual([false, false])
    expect(account.signedIn).toBe(false)
    vi.unstubAllGlobals()
  })
})
describe('the account across windows', () => {
  const shared = new EventTarget()
  const kept = new Map<string, string>()
  const user = { id: 'uw', email: 'win@example.org', name: 'Win' }
  const queues = new Map<string, Promise<unknown>>()
  const locks = {
    request: (name: string, work: () => Promise<unknown>) => {
      const turn = (queues.get(name) ?? Promise.resolve()).then(work)
      queues.set(
        name,
        turn.catch(() => undefined),
      )
      return turn
    },
  }
  let letGo: () => void = () => undefined
  function asking() {
    kept.set('orden:unsettled', user.id)
    void locks.request('orden:settling', () => new Promise<void>((done) => (letGo = done)))
  }
  function signedInThere() {
    kept.set('orden:session', 'from-elsewhere')
    shared.dispatchEvent(Object.assign(new Event('storage'), { key: 'orden:session' }))
  }
  beforeEach(() => {
    kept.clear()
    queues.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    vi.stubGlobal('window', shared)
    vi.stubGlobal('navigator', { locks })
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      const token = (init.headers as Record<string, string> | undefined)?.authorization
      return url.endsWith('/v1/me') && token === 'Bearer from-elsewhere'
        ? Promise.resolve(new Response(JSON.stringify({ user })))
        : Promise.reject(new Error('offline'))
    })
  })
  afterEach(async () => {
    letGo()
    await account.signOut()
    account.settleWith(() => Promise.resolve())
    vi.unstubAllGlobals()
  })
  test('a sign-in in another window signs this window in too, without a reload', async () => {
    await account.restore()
    expect(account.signedIn).toBe(false)
    signedInThere()
    await vi.waitFor(() => expect(account.user?.id).toBe('uw'))
    expect(account.signedIn).toBe(true)
    await vi.waitFor(() => expect(account.syncable).toBe(true))
  })
  test('while the window that signed in still asks how to meet this device’s notes, this one does not sync', async () => {
    await account.restore()
    asking()
    signedInThere()
    await vi.waitFor(() => expect(account.signedIn).toBe(true))
    await new Promise((done) => setTimeout(done, 20))
    expect(account.syncable).toBe(false)
    kept.delete('orden:unsettled')
    letGo()
    await vi.waitFor(() => expect(account.syncable).toBe(true))
  })
  test('if that window goes before it was answered, this one asks instead, and only it', async () => {
    let asked = 0
    account.settleWith(() => {
      asked++
      account.settled()
      return Promise.resolve()
    })
    await account.restore()
    asking()
    signedInThere()
    await vi.waitFor(() => expect(account.signedIn).toBe(true))
    expect(asked).toBe(0)
    letGo()
    await vi.waitFor(() => expect(account.syncable).toBe(true))
    expect(asked).toBe(1)
    expect(kept.has('orden:unsettled')).toBe(false)
  })
  test('a window opened again while another still asks waits for that answer too', async () => {
    asking()
    kept.set('orden:session', 'from-elsewhere')
    await account.restore()
    await vi.waitFor(() => expect(account.signedIn).toBe(true))
    await new Promise((done) => setTimeout(done, 20))
    expect(account.syncable).toBe(false)
    kept.delete('orden:unsettled')
    letGo()
    await vi.waitFor(() => expect(account.syncable).toBe(true))
  })
})
describe('a list or a map kept on the account', () => {
  const server = { settings: {} as Record<string, unknown>, offline: false }
  const kept = new Map<string, string>()
  beforeEach(() => {
    kept.clear()
    server.settings = {}
    server.offline = false
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (server.offline || !url.endsWith('/v1/settings')) return Promise.reject(new Error('offline'))
      if (init.method === 'PATCH' && typeof init.body === 'string')
        Object.assign(server.settings, JSON.parse(init.body))
      return Promise.resolve(new Response(JSON.stringify({ settings: structuredClone(server.settings) })))
    })
    account.token = 'token'
    account.user = { id: 'u1', email: 'ada@example.org', name: 'Ada' }
  })
  afterEach(() => {
    account.token = null
    account.user = null
    vi.unstubAllGlobals()
  })
  async function heard(settings: Record<string, unknown>) {
    server.settings = structuredClone(settings)
    await api.settings('token')
  }
  test('is never undone in one item by another device changing another', async () => {
    await heard({ archivedSpaces: ['a'] })
    server.settings.archivedSpaces = ['a', 'b']
    await api.saveSettings('token', { archivedSpaces: ['a', 'c'] })
    expect(server.settings.archivedSpaces).toEqual(['a', 'b', 'c'])
  })
  test('loses only what this device took out, never what the other added', async () => {
    await heard({ archivedSpaces: ['a', 'b'] })
    server.settings.archivedSpaces = ['a', 'b', 'd']
    await api.saveSettings('token', { archivedSpaces: ['a'] })
    expect(server.settings.archivedSpaces).toEqual(['a', 'd'])
  })
  test('in a map keeps the other device’s keys beside this one’s', async () => {
    await heard({ glassesMarks: { bold: true, italic: false } })
    server.settings.glassesMarks = { bold: true, italic: false, strike: true }
    await api.saveSettings('token', { glassesMarks: { italic: true } })
    expect(server.settings.glassesMarks).toEqual({ italic: true, strike: true })
  })
  test('changed offline and sent after a reload heard newer settings still keeps the other device’s change', async () => {
    const owed = new AccountOwed('orden:test-owed-settings')
    await heard({ archivedSpaces: ['a'] })
    server.offline = true
    owed.send({ archivedSpaces: ['a', 'c'] })
    await owed.settle('token')
    expect(owed.standing).toBe(true)
    server.offline = false
    await heard({ archivedSpaces: ['a', 'b'] })
    expect(heardSettings()?.archivedSpaces).toEqual(['a', 'b'])
    await owed.settle('token')
    expect(server.settings.archivedSpaces).toEqual(['a', 'b', 'c'])
    expect(owed.standing).toBe(false)
  })
  test('sent beside a change of this device’s own does not overwrite what it did not change', async () => {
    await heard({ shortcuts: { save: 'Mod-s' }, preset: 'orden' })
    server.settings.shortcuts = { save: 'Mod-s', find: 'Mod-f' }
    await api.saveSettings('token', { shortcuts: { save: 'Mod-s' }, preset: 'vscode' })
    expect(server.settings).toEqual({ shortcuts: { save: 'Mod-s', find: 'Mod-f' }, preset: 'vscode' })
  })
})
describe('settings owed when the account signs out', () => {
  const accounts: Record<string, Record<string, unknown>> = { alice: {}, bob: {} }
  const kept = new Map<string, string>()
  let offline = false
  beforeEach(() => {
    kept.clear()
    accounts.alice = {}
    accounts.bob = {}
    offline = false
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      const who = (init.headers as Record<string, string> | undefined)?.authorization?.replace('Bearer ', '') ?? ''
      const settings = accounts[who]
      if (offline || !url.endsWith('/v1/settings') || !settings) return Promise.reject(new Error('offline'))
      if (init.method === 'PATCH' && typeof init.body === 'string') Object.assign(settings, JSON.parse(init.body))
      return Promise.resolve(new Response(JSON.stringify({ settings })))
    })
  })
  afterEach(() => {
    account.token = null
    account.user = null
    vi.unstubAllGlobals()
  })
  function as(who: string) {
    account.token = who
    account.user = { id: who, email: `${who}@example.org`, name: who }
  }
  test('reach that account the next time it signs in, and never another', async () => {
    const owed = new AccountOwed('orden:test-owed-leaving')
    as('alice')
    offline = true
    owed.send({ developer: true, hardBreaks: true })
    await owed.settle('alice')
    expect(owed.standing).toBe(true)
    await account.signOut()
    offline = false
    as('bob')
    expect(owed.standing).toBe(false)
    await owed.settle('bob')
    expect(accounts.bob).toEqual({})
    await account.signOut()
    as('alice')
    expect(owed.standing).toBe(true)
    await owed.settle('alice')
    expect(accounts.alice).toEqual({ developer: true, hardBreaks: true })
    expect(owed.standing).toBe(false)
  })
  test('another account signing in does not take on the last account’s local settings, and the last one gets its own back', async () => {
    let reset = 0
    const owed = new AccountOwed('orden:test-owed-held', undefined, () => reset++)
    as('alice')
    await owed.settle('alice')
    expect(reset).toBe(0)
    await account.signOut()
    as('bob')
    await owed.settle('bob')
    expect(reset).toBe(1)
    await owed.settle('bob')
    expect(reset).toBe(1)
    await account.signOut()
    as('alice')
    await owed.settle('alice')
    expect(reset).toBe(2)
  })
  test('a store put back for the account that signs in starts from what that account still owes', async () => {
    const given: Record<string, unknown>[] = []
    const owed = new AccountOwed('orden:test-owed-given', undefined, (patch) => given.push(patch))
    offline = true
    as('alice')
    await owed.settle('alice')
    owed.send({ vim: true })
    await account.signOut()
    as('bob')
    await owed.settle('bob')
    await account.signOut()
    offline = false
    as('alice')
    await owed.settle('alice')
    expect(given).toEqual([{}, { vim: true }])
    expect(accounts.alice).toEqual({ vim: true })
  })
  test('a change one account still owes is kept beside what another then owes', async () => {
    const owed = new AccountOwed('orden:test-owed-two')
    offline = true
    as('alice')
    owed.send({ vim: true })
    await account.signOut()
    as('bob')
    owed.send({ preset: 'vscode' })
    offline = false
    await owed.settle('bob')
    expect(accounts.bob).toEqual({ preset: 'vscode' })
    await account.signOut()
    as('alice')
    await owed.settle('alice')
    expect(accounts.alice).toEqual({ vim: true })
  })
})
