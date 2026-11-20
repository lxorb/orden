import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { Cadence, nextPassIn } from '../src/cadence'
import { hubDeviceOf, madeDeviceId } from '../src/made-device'
import { accountOver } from '../src/transport'
import { portProvided, providePort } from '@orden/contracts'
import {
  act,
  apart,
  CALM,
  Clock,
  markersIn,
  pass,
  ReferenceAccount,
  type Report,
  SEEDED,
  simulate,
  type Step,
} from '@orden/sync-core/sim'
import { MemoryDisk, MemoryStore } from '../src/api'
import { firstPass } from '../src/migrate'
import { madeTwice } from '../src/twins'
import { SpaceState } from '../src/places'
import { scan, type EntryRow } from '../src/store'
import { EngineDevice, type FreshDevice, freshDevice } from './sim-device'
import { memoryStorage } from './memory-storage'
import { dropLeft, leftHere, ownRoots, unsentRoots } from '../src/left'

const settle: Step = { t: 'wait', ticks: 40 }
function road(script: readonly Step[]): Promise<Report> {
  return simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
  })
}
function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}
const PLAN = 0
const SHELL = ['workspace/', 'account.svelte', 'settings/', 'tauri', 'stored', 'api', 'new-tab']
function sources(folder: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) out.push(...sources(path))
    else if (/\.(?:ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(path)
  }
  return out
}
describe('the module stands on its own', () => {
  test('its api loads with no port bound, and binds nothing itself', () => {
    expect(portProvided('sync.account')).toBe(false)
    expect(portProvided('sync.workspace')).toBe(false)
    expect(new MemoryStore('d').rows('spaces')).toEqual([])
    expect(new MemoryDisk().files.size).toBe(0)
  })
  test('reaches the shell, the account and the host only through ports', () => {
    const reaching: string[] = []
    for (const file of sources(join(import.meta.dirname, '../src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/from\s+'(\.\.\/\.\.\/[^']+)'|import\('(\.\.\/\.\.\/[^']+)'\)/g)) {
        const target = (match[1] ?? match[2] ?? '').slice('../../'.length)
        if (SHELL.some((one) => target === one || target.startsWith(one)))
          reaching.push(`${file.slice(file.lastIndexOf('/') + 1)} -> ${target}`)
      }
    }
    expect(reaching).toEqual([])
  })
})
describe('a device that has never synced', () => {
  test('reads the whole tree from the feed at cursor 0, and writes every note to its disk', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await freshDevice(account, 'fresh-empty')
    expect(await firstPass(here.engine.core, here.space(), null)).toBe(true)
    await here.engine.pass('sim')
    const names = [...here.space().entries.values()].map((one) => one.name).sort()
    expect(names).toEqual(SEEDED.map((one) => one.name).sort())
    for (const note of SEEDED) {
      expect(here.space().entries.get(note.id)?.name).toBe(note.name)
      expect(here.disk.files.get(`/fresh/fresh-empty/${note.name}`)).toBe(note.text)
    }
    expect(here.space().outbox).toEqual([])
  })
  test('whose disk already holds the notes claims them at their place, and makes nothing twice', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const files = Object.fromEntries(SEEDED.map((one) => [one.name, one.text]))
    const here = await freshDevice(account, 'fresh-held', files)
    const before = (await account.view()).entries.map((one) => one.id).sort()
    expect(await firstPass(here.engine.core, here.space(), null)).toBe(true)
    await here.engine.pass('sim')
    const after = await account.view()
    expect(after.entries.map((one) => one.id).sort()).toEqual(before)
    expect(after.entries.map((one) => one.name).sort()).toEqual(['Ideas.md', 'Plan.md'])
    for (const note of SEEDED) expect(here.space().at(note.name)?.id).toBe(note.id)
    expect(here.disk.files.size).toBe(SEEDED.length)
    expect(here.space().outbox).toEqual([])
  })
})
describe('a name made twice', () => {
  function row(id: string, name: string, local: string, hash: string, deleted = false): EntryRow {
    return {
      id,
      space_id: 's',
      kind: 'file',
      parent: null,
      name,
      local_path: local,
      file_key: hash,
      written_hash: hash,
      mtime: null,
      size: null,
      seq: 1,
      deleted,
    }
  }
  function space(rows: EntryRow[]) {
    return new SpaceState({ space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null }, rows, [], 'd', {
      platform: 'linux',
      foldsCase: true,
    } as never)
  }
  test('a numbered twin goes back to its name once the original is gone with the same bytes', () => {
    expect(
      madeTwice(space([row('a', 'Photo.png', '', 'p1', true), row('b', 'Photo 2.png', 'Photo 2.png', 'p1')])),
    ).toEqual([{ from: 'Photo 2.png', to: 'Photo.png' }])
  })
  test('a numbered name the reader chose, or other bytes, is kept', () => {
    expect(madeTwice(space([row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'h1')]))).toEqual([])
    expect(
      madeTwice(space([row('a', 'Plan.pdf', '', 'old', true), row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'new')])),
    ).toEqual([])
  })
  test('two notes of one name made apart are two notes, the second numbered', async () => {
    const make = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: { t: 'create', folder: null, name: 'Untitled.md', words: marker },
    })
    const report = await road([
      { t: 'offline', device: 0 },
      make(0, 'mk201z'),
      make(1, 'mk202z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(report.account.entries.map((one) => one.name).sort()).toEqual([
      'Ideas.md',
      'Plan.md',
      'Untitled 2.md',
      'Untitled.md',
    ])
  })
})
describe('offline, then back', () => {
  test('what was typed offline waits in the outbox and goes up on the first pass online', async () => {
    const report = await road([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'mk401z' } },
      { t: 'pass', device: 0 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(markersIn(textOf(report, 'Plan.md'))).toContain('mk401z')
  })
  test('an edit made offline and one made elsewhere merge character by character, with no copy', async () => {
    const report = await road([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'mk101z' } },
      { t: 'act', device: 1, action: { t: 'type', note: PLAN, at: 1, words: 'mk102z' } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(expect.arrayContaining(['mk101z', 'mk102z']))
    expect(report.account.entries.filter((one) => one.name.includes('from another'))).toEqual([])
  })
})
describe('a delete heard from the account', () => {
  const gone = (target: number): Step => act(1, { t: 'delete', target })
  const FOLDER: Step[] = [
    act(1, { t: 'mkdir', folder: null, name: 'Work' }),
    act(1, { t: 'create', folder: 0, name: 'Inside.md', words: 'Inside the folder.' }),
    pass(1),
    settle,
    pass(0),
    settle,
  ]
  const WORK = 0
  const INSIDE = 0
  const back = (report: Report) => {
    const work = report.account.entries.find((one) => one.name === 'Work')
    return { work, inside: report.account.entries.find((one) => one.name === 'Inside.md') }
  }
  test('of a note written here meanwhile brings the note back with these words', async () => {
    const report = await road(
      apart([act(0, { t: 'type', note: PLAN, at: 0.5, words: 'mk901z' })], [gone(PLAN)], pass(1), settle),
    )
    expect(report.failures).toEqual([])
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(['mk901z'])
  })
  test('of a note another program changed here meanwhile brings the note back with that change', async () => {
    const report = await road(
      apart([act(0, { t: 'edit-file', note: PLAN, at: 0.2, words: 'mk921z', cut: 0 })], [gone(PLAN)], pass(1), settle),
    )
    expect(report.failures).toEqual([])
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(['mk921z'])
  })
  test('of a folder, with nothing written here, takes the folder and what it held', async () => {
    const report = await road([...FOLDER, ...apart([], [gone(WORK)], pass(1), settle)])
    expect(report.failures).toEqual([])
    expect(report.account.entries.map((one) => one.name).sort()).toEqual(['Ideas.md', 'Plan.md'])
  })
  test('of a folder whose note was written here meanwhile brings both back with these words', async () => {
    const report = await road([
      ...FOLDER,
      ...apart([act(0, { t: 'type', note: INSIDE, at: 1, words: 'mk911z' })], [gone(WORK)], pass(1), settle),
    ])
    expect(report.failures).toEqual([])
    const { work, inside } = back(report)
    expect(work?.kind).toBe('folder')
    expect(inside?.parent).toBe(work?.id)
    expect(markersIn(textOf(report, 'Inside.md'))).toEqual(['mk911z'])
  })
  test('of a folder a note was made in meanwhile keeps that note and its words', async () => {
    const report = await road([
      ...FOLDER,
      ...apart(
        [act(0, { t: 'create', folder: 0, name: 'Later.md', words: 'Made later mk912z' })],
        [gone(WORK)],
        pass(1),
        settle,
      ),
    ])
    expect(report.failures).toEqual([])
    expect(markersIn(textOf(report, 'Later.md'))).toEqual(['mk912z'])
  })
  test('of a canvas changed here meanwhile brings the canvas back with that change', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const there = await freshDevice(account, 'there')
    const here = await freshDevice(account, 'here')
    for (const one of [there, here]) {
      expect(await firstPass(one.engine.core, one.space(), null)).toBe(true)
      await one.engine.pass('sim')
    }
    const board = (text: string) =>
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text, x: 0, y: 0, width: 100, height: 50 }], edges: [] })
    const at = (one: FreshDevice) => `${one.space().row.root}/Board.canvas`
    await there.disk.write(at(there), board('first'))
    await there.engine.created(at(there), false, board('first'))
    await there.engine.pass('sim')
    await here.engine.pass('sim')
    expect(here.disk.files.get(at(here))).toContain('first')
    const id = there.engine.entryAt(at(there))?.id ?? ''
    await here.disk.write(at(here), board('mk941z'))
    await here.engine.foreign(at(here))
    await there.engine.removing(at(there), async () => {
      await there.disk.remove(at(there))
      return id
    })
    await there.engine.pass('sim')
    expect((await account.view()).entries.map((one) => one.name)).not.toContain('Board.canvas')
    await here.engine.pass('sim')
    await there.engine.pass('sim')
    expect((await account.view()).entries.find((one) => one.id === id)?.name).toBe('Board.canvas')
    expect(here.disk.files.get(at(here))).toContain('mk941z')
    expect(there.disk.files.get(at(there))).toContain('mk941z')
  })
})
describe('words the account refuses once the space is only read here (#2249)', () => {
  async function lowered(name: string, first: string, mine: string) {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const reading = { on: false }
    const member = await freshDevice(account, 'member', {}, (route, body) =>
      reading.on && route === 'push'
        ? { docs: (body as { docs: { id: string }[] }).docs.map(({ id }) => ({ id, refused: 'role' })) }
        : undefined,
    )
    const owner = await freshDevice(account, 'owner')
    for (const one of [owner, member]) {
      expect(await firstPass(one.engine.core, one.space(), null)).toBe(true)
      await one.engine.pass('sim')
    }
    const at = (one: FreshDevice) => `${one.space().row.root}/${name}`
    if (!owner.disk.files.has(at(owner))) {
      await owner.disk.write(at(owner), first)
      await owner.engine.created(at(owner), false, first)
      await owner.engine.pass('sim')
      await member.engine.pass('sim')
    }
    const theirs = member.disk.files.get(at(member))
    await member.disk.write(at(member), mine)
    await member.engine.foreign(at(member))
    reading.on = true
    await member.engine.pass('sim')
    const [rows] = await member.engine.core.store.read([scan('log')])
    return { member, theirs, file: at(member), logged: rows.flatMap((row) => row.failed ?? []) }
  }
  const board = (text: string) =>
    JSON.stringify({ nodes: [{ id: 'a', type: 'text', text, x: 0, y: 0, width: 100, height: 50 }], edges: [] })
  test.each([
    ['Plan.md', '', 'Written here while away mk951z\n'],
    ['Board.canvas', board('first'), board('mk952z')],
    ['Book.pages', board('first'), board('mk953z')],
  ])('in %s go to this device’s Recently deleted, said with their place', async (name, first, mine) => {
    const { member, theirs, file, logged } = await lowered(name, first, mine)
    const marker = markersIn(mine)[0] ?? ''
    expect(member.disk.trashed.map((one) => one.path)).toEqual([file])
    expect(member.disk.trashed[0]?.text).toContain(marker)
    expect(member.disk.files.get(file)).toBe(theirs)
    expect(logged).toEqual([`you can only read this space, so your change to ${name} went to Recently deleted`])
    expect(member.engine.core.hasPending(member.engine.entryAt(file)?.id ?? '')).toBe(false)
  })
})
describe('how soon what changed here goes up (#2280)', () => {
  test('a change to the tree starts a pass at once, and one made during a pass starts the next as it ends', async () => {
    const runs: (() => void)[] = []
    const cadence = new Cadence({
      run: () => new Promise<void>((done) => runs.push(done)),
      owed: () => true,
      fire: () => undefined,
      next: () => null,
    })
    cadence.go()
    expect(runs).toHaveLength(1)
    cadence.go()
    expect(runs).toHaveLength(1)
    runs[0]?.()
    await new Promise((settled) => setTimeout(settled, 0))
    expect(runs).toHaveLength(2)
    cadence.stop()
  })
  test('while the account answers and the hub is not open, the next pass is never more than 5 s away', () => {
    for (let quiet = 0; quiet <= 8; quiet += 1) {
      const at = nextPassIn({ waiting: false, local: false, hubOpen: false, hidden: false, online: true, quiet })
      expect(at).toBeLessThanOrEqual(5_000)
    }
  })
})
describe('the device a request names (#2280)', () => {
  test('is the one the hub says hello with, so a push from one of two devices on one session is told apart', async () => {
    const kept = 'f00dfeedcafe1234'
    const asked: Request[] = []
    await accountOver({
      base: 'https://sync.test',
      token: () => 'shared-session',
      device: () => 'Laptop',
      deviceId: () => hubDeviceOf(kept, 'u1'),
      fetch: (request) => {
        asked.push(request)
        return Promise.resolve(new Response('', { status: 503 }))
      },
    }).ask('push', { docs: [] }, 's')
    expect(asked[0]?.headers.get('x-orden-device-id')).toBe(kept)
    const texts = new Map<string, string>()
    const unbind = providePort('sync.storage', {
      text: (key: string) => texts.get(key) ?? null,
      keepText: (key: string, value: string) => texts.set(key, value).has(key),
      json: () => null,
      keepJson: () => false,
      forget: (key: string) => void texts.delete(key),
    })
    try {
      expect(hubDeviceOf('not ok!', 'u1')).toBe(madeDeviceId('u1'))
    } finally {
      unbind()
    }
  })
})
describe('a space signed out of (#2252)', () => {
  function shown(roots: readonly string[], dropped: string[] = []) {
    return providePort('sync.workspace', {
      spaces: roots.map((root, at) => ({ id: `w${String(at)}`, root, name: root })),
      dropSpace: (id: string) => Promise.resolve(void dropped.push(id)),
    } as never)
  }
  async function signedOutOf(run: () => Promise<void>) {
    vi.stubGlobal('localStorage', memoryStorage())
    try {
      await run()
    } finally {
      vi.unstubAllGlobals()
    }
  }
  test('that sign-out could not drop, being no longer listed, keeps the mark of the account that left it', () =>
    signedOutOf(async () => {
      leftHere('alice', ['/s/Work'], false)
      const dropped: string[] = []
      const hidden = shown([], dropped)
      await dropLeft(['/s/Work'])
      hidden()
      const back = shown(['/s/Work'])
      expect(ownRoots('bob')).toEqual([])
      expect(ownRoots('alice')).toEqual(['/s/Work'])
      back()
      expect(dropped).toEqual([])
    }))
  test('with words not yet sent stays on this device as the leaving account’s, and is no other account’s', () =>
    signedOutOf(async () => {
      const here = await freshDevice(new ReferenceAccount(new Clock(), SEEDED), 'alice-device')
      expect(await firstPass(here.engine.core, here.space(), null)).toBe(true)
      await here.engine.pass('sim')
      const root = here.space().row.root
      const done = () => Promise.resolve(true)
      expect(await unsentRoots(here.engine, [root], done)).toEqual([])
      await here.disk.write(`${root}/Plan.md`, 'Written before signing out mk961z\n')
      await here.engine.foreign(`${root}/Plan.md`)
      const unsent = await unsentRoots(here.engine, [root], done)
      expect(unsent).toEqual([root])
      leftHere('alice', [root], false)
      const dropped: string[] = []
      const listed = shown([root], dropped)
      await dropLeft([root].filter((one) => !unsent.includes(one)))
      expect(dropped).toEqual([])
      expect(ownRoots('bob')).toEqual([])
      expect(ownRoots('alice')).toEqual([root])
      listed()
    }))
})
describe('every file the app writes in a space (#2301)', () => {
  test('a new binary file in a folder the account has not seen goes up as the folder and the file, bytes and all', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const kept = new Map<string, Uint8Array>()
    const hashes = new Map<string, string>()
    const heard = (route: string, body: unknown) => {
      if (route !== 'ops') return undefined
      for (const op of (body as { ops: { t: string; id: string; hash?: string }[] }).ops) {
        if (op.t === 'create' && op.hash) hashes.set(op.id, op.hash)
      }
      return undefined
    }
    const blobs = (disk: MemoryDisk) => ({
      read: (path: string) => disk.readBytes(path),
      write: (path: string, bytes: Uint8Array) => disk.writeBytes(path, bytes),
      hash: (bytes: Uint8Array) => Promise.resolve(`h-${new TextDecoder().decode(bytes)}`),
      up: (hash: string, bytes: Uint8Array) => Promise.resolve(void kept.set(hash, bytes)).then(() => true),
      down: (_space: string, id: string) => Promise.resolve(kept.get(hashes.get(id) ?? '') ?? null),
      replace: () => Promise.resolve(null),
    })
    const here = await freshDevice(account, 'here', {}, heard, blobs)
    const there = await freshDevice(account, 'there', {}, heard, blobs)
    for (const one of [here, there]) {
      expect(await firstPass(one.engine.core, one.space(), null)).toBe(true)
      await one.engine.pass('sim')
    }
    const made = `${here.space().row.root}/assets/minutes.pdf`
    await here.disk.writeBytes(made, new TextEncoder().encode('%PDF minutes'))
    await here.engine.created(made, false)
    await here.engine.pass('sim')
    await there.engine.pass('sim')
    const entries = (await account.view()).entries
    const folder = entries.find((one) => one.name === 'assets')
    expect(folder?.kind).toBe('folder')
    expect(entries.find((one) => one.name === 'minutes.pdf')).toMatchObject({ kind: 'file', parent: folder?.id })
    const arrived = await there.disk.readBytes(`${there.space().row.root}/assets/minutes.pdf`)
    expect(new TextDecoder().decode(arrived ?? new Uint8Array())).toBe('%PDF minutes')
  })
})
describe('ports', () => {
  test('a port bound by the shell is what the module reads', () => {
    const unbind = providePort('sync.clock', { now: () => 42, waited: () => Promise.resolve() })
    expect(portProvided('sync.clock')).toBe(true)
    unbind()
    expect(portProvided('sync.clock')).toBe(false)
  })
})
