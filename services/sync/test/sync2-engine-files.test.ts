import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import app from '../src'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

interface Core {
  spaces: Map<string, { outbox: unknown[]; entries: Map<string, { name: string }> }>
  held: Map<string, unknown>
  addSpace(id: string, root: string, role: string): unknown[]
  commit(changes: unknown[]): Promise<void>
}

interface Device {
  root: string
  store: { rows(table: 'log'): { failed: string | null }[]; open(): unknown }
  disk: {
    bytes: Map<string, Uint8Array>
    files: Map<string, string>
    kept: unknown[]
    readBytes(path: string): Promise<Uint8Array | null>
    writeBytes(path: string, bytes: Uint8Array): Promise<void>
    write(path: string, text: string): Promise<void>
    remove(path: string): Promise<void>
    mkdir(path: string): Promise<void>
    move(from: string, to: string): Promise<void>
  }
  engine: {
    core: Core & { world: unknown }
    pass(space: string): Promise<{ finished: boolean; full: boolean } | null>
    created(path: string, dir: boolean, text?: string): Promise<string | null>
    foreign(path: string): Promise<void>
    removed(path: string): Promise<void>
    moved(from: string, to: string): Promise<void>
    waiting(space: string): boolean
    stamped(path: string, mtime: number, size: number): Promise<void>
    stop(): void
    on(type: 'unsynced', listener: (event: { name: string }) => void): () => void
    held: {
      notes: readonly { id: string }[]
      answer(id: string, answer: string): Promise<string | undefined>
    }
  }
}

interface Kit {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    name?: string
    files?: Record<string, string | Uint8Array>
  }): Promise<Device>
  firstPass(core: Core, space: unknown, v1: null): Promise<boolean>
  Engine: { start(world: unknown, store: unknown): Promise<Device['engine']> }
}

async function kit(): Promise<Kit> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync-client/${file}`, import.meta.url).href
  const [device, migrate, engine] = await Promise.all([
    import(/* @vite-ignore */ at('test/test-device.ts')),
    import(/* @vite-ignore */ at('src/migrate.ts')),
    import(/* @vite-ignore */ at('src/engine.ts')),
  ])
  return { ...(device as object), ...(migrate as object), ...(engine as object) } as Kit
}

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'pictures@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Pictures' } })).json.space.id
})

afterEach(() => env.close())

const picture = (seed: number) =>
  new Uint8Array(Array.from({ length: 4096 }, (_, at) => (at * seed) % 251))

async function device(
  name: string,
  files: Record<string, string | Uint8Array> = {},
  as = { token, role: 'owner' },
): Promise<Device> {
  const made = await (
    await kit()
  ).testDevice({
    fetch: async (request) => await app.fetch(request, env),
    token: as.token,
    name,
    files,
  })
  const core = made.engine.core
  await core.commit(core.addSpace(space, made.root, as.role))
  expect(await (await kit()).firstPass(core, core.spaces.get(space), null)).toBe(true)
  await rooms.settle()
  return made
}

async function passed(...devices: Device[]) {
  for (let round = 0; round < 2; round += 1) {
    for (const one of devices) {
      await one.engine.pass(space)
      await rooms.settle()
    }
  }
}

const bytesAt = (one: Device, path: string) => one.disk.bytes.get(`${one.root}/${path}`)

describe('a file that is not a note, under v2', () => {
  test('made on one device, it reaches the other as its bytes', async () => {
    const laptop = await device('laptop', { 'Trip/photo.png': picture(3) })
    const phone = await device('phone')
    await passed(laptop, phone)

    expect(bytesAt(phone, 'Trip/photo.png')).toEqual(picture(3))
  })

  test('replaced on one device, the other takes the new bytes', async () => {
    const laptop = await device('laptop', { 'photo.png': picture(3) })
    const phone = await device('phone')
    await passed(laptop, phone)

    await laptop.disk.writeBytes(`${laptop.root}/photo.png`, picture(5))
    await laptop.engine.foreign(`${laptop.root}/photo.png`)
    await passed(laptop, phone)

    expect(bytesAt(phone, 'photo.png')).toEqual(picture(5))
  })

  test('replaced here with the answer lost, it is in step next time, not held', async () => {
    let lose = false
    const made = await (
      await kit()
    ).testDevice({
      fetch: async (request) => {
        const replacing = request.method === 'PUT' && request.url.includes('/v2/files/')
        const answer = await app.fetch(request, env)
        if (lose && replacing) throw new TypeError('the answer was lost')
        return answer
      },
      token,
      name: 'laptop',
      files: { 'photo.png': picture(3) },
    })
    const core = made.engine.core
    await core.commit(core.addSpace(space, made.root, 'owner'))
    expect(await (await kit()).firstPass(core, core.spaces.get(space), null)).toBe(true)
    await passed(made)

    await made.disk.writeBytes(`${made.root}/photo.png`, picture(5))
    await made.engine.foreign(`${made.root}/photo.png`)
    lose = true
    expect((await made.engine.pass(space))?.finished).toBe(false)
    lose = false
    await made.engine.foreign(`${made.root}/photo.png`)
    await passed(made)

    expect(made.engine.held.notes).toHaveLength(0)
    expect(made.engine.core.held.size).toBe(0)
    const phone = await device('phone')
    await passed(phone)
    expect(bytesAt(phone, 'photo.png')).toEqual(picture(5))
  })

  test('replaced on both while apart, it is held and asked; Keep both keeps both', async () => {
    const laptop = await device('laptop', { 'photo.png': picture(3) })
    const phone = await device('phone')
    await passed(laptop, phone)

    await laptop.disk.writeBytes(`${laptop.root}/photo.png`, picture(5))
    await laptop.engine.foreign(`${laptop.root}/photo.png`)
    await phone.disk.writeBytes(`${phone.root}/photo.png`, picture(7))
    await phone.engine.foreign(`${phone.root}/photo.png`)
    await laptop.engine.pass(space)
    await phone.engine.pass(space)

    expect(phone.engine.held.notes).toHaveLength(1)
    expect(bytesAt(phone, 'photo.png')).toEqual(picture(7))

    const copy = await phone.engine.held.answer(phone.engine.held.notes[0]?.id ?? '', 'both')
    expect(copy).toContain('photo (phone).png')
    await passed(phone, laptop)

    for (const one of [laptop, phone]) {
      expect(bytesAt(one, 'photo.png')).toEqual(picture(5))
      expect(bytesAt(one, 'photo (phone).png')).toEqual(picture(7))
    }
  })

  test('replaced on both, Keep mine sends this device’s bytes everywhere', async () => {
    const laptop = await device('laptop', { 'photo.png': picture(3) })
    const phone = await device('phone')
    await passed(laptop, phone)

    await laptop.disk.writeBytes(`${laptop.root}/photo.png`, picture(5))
    await laptop.engine.foreign(`${laptop.root}/photo.png`)
    await phone.disk.writeBytes(`${phone.root}/photo.png`, picture(7))
    await phone.engine.foreign(`${phone.root}/photo.png`)
    await laptop.engine.pass(space)
    await phone.engine.pass(space)

    await phone.engine.held.answer(phone.engine.held.notes[0]?.id ?? '', 'mine')
    await passed(phone, laptop)
    expect(phone.engine.held.notes).toHaveLength(0)
    expect(bytesAt(laptop, 'photo.png')).toEqual(picture(7))
  })

  test('fetched onto a file this device has not read yet, it waits and both are kept', async () => {
    const laptop = await device('laptop')
    const desktop = await device('desktop')
    await laptop.disk.writeBytes(`${laptop.root}/Scan.pdf`, picture(3))
    await laptop.engine.created(`${laptop.root}/Scan.pdf`, false)
    await desktop.disk.writeBytes(`${desktop.root}/Scan.pdf`, picture(7))
    await laptop.engine.pass(space)
    await rooms.settle()
    await desktop.engine.pass(space)
    await rooms.settle()

    expect(bytesAt(desktop, 'Scan.pdf')).toEqual(picture(7))

    await desktop.engine.created(`${desktop.root}/Scan.pdf`, false)
    await passed(laptop, desktop)
    for (const one of [laptop, desktop]) {
      const kept = [...one.disk.bytes.values()].map((bytes) => bytes[1])
      expect(kept.sort()).toEqual([picture(3)[1], picture(7)[1]].sort())
    }
  })

  test('one the disk refuses to write waits for the next pass, and the rest arrive', async () => {
    const laptop = await device('laptop', { 'a.png': picture(3), 'b.png': picture(5) })
    const desktop = await device('desktop')
    const real = desktop.disk.writeBytes.bind(desktop.disk)
    let locked = true
    desktop.disk.writeBytes = async (path, bytes) => {
      if (locked && path.endsWith('/a.png')) throw new Error(`${path} is open in another program`)
      await real(path, bytes)
    }
    await passed(laptop, desktop)

    expect(bytesAt(desktop, 'a.png')).toBeUndefined()
    expect(bytesAt(desktop, 'b.png')).toEqual(picture(5))

    locked = false
    await passed(laptop, desktop)
    expect(bytesAt(desktop, 'a.png')).toEqual(picture(3))
    expect(desktop.engine.held.notes).toHaveLength(0)
    expect([...desktop.disk.bytes.keys()].sort()).toEqual([
      `${desktop.root}/a.png`,
      `${desktop.root}/b.png`,
    ])
  })

  test('deleted on one device, it is gone from the other', async () => {
    const laptop = await device('laptop', { 'photo.png': picture(3) })
    const phone = await device('phone')
    await passed(laptop, phone)

    laptop.disk.bytes.delete(`${laptop.root}/photo.png`)
    await laptop.engine.removed(`${laptop.root}/photo.png`)
    await passed(laptop, phone)

    expect(bytesAt(phone, 'photo.png')).toBeUndefined()
  })
})

describe('a file whose bytes on this disk cannot be judged', () => {
  const entryOf = (one: Device, name: string) =>
    [...(one.engine.core.spaces.get(space)?.entries.values() ?? [])].find(
      (entry) => entry.name === name,
    ) as unknown as { file_key: string; written_hash: string; mtime: number | null }

  const replacedElsewhere = async (other: Device, name: string) => {
    await other.disk.writeBytes(`${other.root}/${name}`, picture(5))
    await other.engine.foreign(`${other.root}/${name}`)
    await other.engine.pass(space)
    await rooms.settle()
  }

  test('past what travels, it is not written over by another device’s replacement', async () => {
    const laptop = await device('laptop', { 'v.bin': picture(3) })
    const desktop = await device('desktop')
    await passed(laptop, desktop)
    const told: string[] = []
    laptop.engine.on('unsynced', (event) => told.push(event.name))
    const big = new Uint8Array(65 * 1024 * 1024).fill(9)
    await laptop.disk.writeBytes(`${laptop.root}/v.bin`, big)
    await laptop.engine.foreign(`${laptop.root}/v.bin`)
    await replacedElsewhere(desktop, 'v.bin')

    const reads = vi.spyOn(laptop.disk, 'readBytes')
    await laptop.engine.pass(space)
    await laptop.engine.pass(space)

    expect(bytesAt(laptop, 'v.bin') === big).toBe(true)
    expect(told).toEqual(['v.bin'])
    expect(reads.mock.calls.filter(([at]) => at.endsWith('/v.bin'))).toEqual([])
    reads.mockRestore()
    expect(bytesAt(desktop, 'v.bin')).toEqual(picture(5))

    await laptop.disk.writeBytes(`${laptop.root}/v.bin`, picture(9))
    await laptop.engine.foreign(`${laptop.root}/v.bin`)
    await laptop.engine.pass(space)
    expect(bytesAt(laptop, 'v.bin')).toEqual(picture(9))
    expect(laptop.engine.held.notes).toHaveLength(1)
  })

  test('that will not read, it is not written over, and read again until it does', async () => {
    const laptop = await device('laptop', { 'v.bin': picture(3) })
    const desktop = await device('desktop')
    await passed(laptop, desktop)
    const path = `${laptop.root}/v.bin`
    const real = laptop.disk.readBytes.bind(laptop.disk)
    let locked = true
    laptop.disk.readBytes = (at) => (locked && at === path ? Promise.resolve(null) : real(at))
    await laptop.disk.writeBytes(path, picture(7))
    await laptop.engine.foreign(path)
    await replacedElsewhere(desktop, 'v.bin')

    await laptop.engine.pass(space)
    await laptop.engine.pass(space)
    expect(bytesAt(laptop, 'v.bin')).toEqual(picture(7))

    locked = false
    await laptop.engine.pass(space)
    expect(bytesAt(laptop, 'v.bin')).toEqual(picture(7))
    expect(laptop.engine.held.notes).toHaveLength(1)
  })

  test('that will not read in step, it goes up once it does, with nothing else to say so', async () => {
    const laptop = await device('laptop', { 'v.bin': picture(3) })
    const desktop = await device('desktop')
    await passed(laptop, desktop)
    const path = `${laptop.root}/v.bin`
    const real = laptop.disk.readBytes.bind(laptop.disk)
    let locked = true
    laptop.disk.readBytes = (at) => (locked && at === path ? Promise.resolve(null) : real(at))
    await laptop.disk.writeBytes(path, picture(7))
    await laptop.engine.foreign(path)
    await laptop.engine.pass(space)
    locked = false
    await passed(laptop, desktop)
    expect(bytesAt(desktop, 'v.bin')).toEqual(picture(7))
  })

  test('not there at all, it is fetched as ever', async () => {
    const laptop = await device('laptop', { 'v.bin': picture(3) })
    const desktop = await device('desktop')
    await passed(laptop, desktop)
    laptop.disk.bytes.delete(`${laptop.root}/v.bin`)
    await replacedElsewhere(desktop, 'v.bin')
    await laptop.engine.pass(space)
    expect(bytesAt(laptop, 'v.bin')).toEqual(picture(5))
  })

  test('grown too large with its create waiting, the reader is told', async () => {
    const laptop = await device('laptop')
    const told: string[] = []
    laptop.engine.on('unsynced', (event) => told.push(event.name))
    const path = `${laptop.root}/new.bin`
    await laptop.disk.writeBytes(path, picture(3))
    await laptop.engine.created(path, false)
    await laptop.disk.writeBytes(path, new Uint8Array(65 * 1024 * 1024).fill(9))

    await laptop.engine.pass(space)

    expect(laptop.engine.core.spaces.get(space)?.outbox).toHaveLength(1)
    expect(told).toEqual(['new.bin'])
  })

  test('with its create waiting, the create waits too rather than being refused', async () => {
    const laptop = await device('laptop')
    const path = `${laptop.root}/new.bin`
    await laptop.disk.writeBytes(path, picture(3))
    await laptop.engine.created(path, false)
    const real = laptop.disk.readBytes.bind(laptop.disk)
    let locked = true
    laptop.disk.readBytes = (at) => (locked && at === path ? Promise.resolve(null) : real(at))

    await laptop.engine.pass(space)
    expect(laptop.engine.core.spaces.get(space)?.outbox).toHaveLength(1)
    expect(laptop.engine.waiting(space)).toBe(false)
    expect(entryOf(laptop, 'new.bin')).toBeTruthy()

    locked = false
    const desktop = await device('desktop')
    await passed(laptop, desktop)
    expect(bytesAt(desktop, 'new.bin')).toEqual(picture(3))
  })

  test('a replacement seen while the account gives no answer goes up on a later pass', async () => {
    let busy = false
    const made = await (
      await kit()
    ).testDevice({
      fetch: async (request) => {
        if (busy && new URL(request.url).pathname.startsWith('/v2/blobs')) {
          return new Response(null, { status: 503 })
        }
        return await app.fetch(request, env)
      },
      token,
      name: 'laptop',
      files: { 'p.png': picture(3) },
    })
    const core = made.engine.core
    await core.commit(core.addSpace(space, made.root, 'owner'))
    expect(await (await kit()).firstPass(core, core.spaces.get(space), null)).toBe(true)
    await rooms.settle()
    await made.engine.pass(space)
    const before = entryOf(made, 'p.png').file_key

    const path = `${made.root}/p.png`
    await made.disk.writeBytes(path, picture(7))
    await made.engine.foreign(path)
    await made.engine.stamped(path, 123, 456)
    busy = true
    await made.engine.pass(space)
    expect(entryOf(made, 'p.png').mtime).not.toBe(123)
    busy = false
    await made.engine.pass(space)

    expect(entryOf(made, 'p.png').file_key).not.toBe(before)
    expect(entryOf(made, 'p.png').file_key).toBe(entryOf(made, 'p.png').written_hash)
    expect(entryOf(made, 'p.png').mtime).toBe(123)
  })

  const hangingDevice = async () => {
    const hung = { hanging: false, begun: (): void => undefined, free: (): void => undefined }
    const made = await (
      await kit()
    ).testDevice({
      fetch: async (request) => {
        if (hung.hanging && new URL(request.url).pathname.startsWith('/v2/blobs')) {
          hung.begun()
          await new Promise<void>((resolve) => (hung.free = resolve))
        }
        return await app.fetch(request, env)
      },
      token,
      name: 'laptop',
      files: { 'p.png': picture(3) },
    })
    const core = made.engine.core
    await core.commit(core.addSpace(space, made.root, 'owner'))
    expect(await (await kit()).firstPass(core, core.spaces.get(space), null)).toBe(true)
    await rooms.settle()
    await made.engine.pass(space)
    return { made, hung }
  }

  const stoppedOnTheWay = async ({ made, hung }: Awaited<ReturnType<typeof hangingDevice>>) => {
    const path = `${made.root}/p.png`
    await made.disk.writeBytes(path, picture(7))
    await made.engine.foreign(path)
    await made.engine.stamped(path, 123, 456)
    hung.hanging = true
    const begun = new Promise<void>((resolve) => (hung.begun = resolve))
    const passing = made.engine.pass(space)
    await begun
    return { path, passing }
  }

  test('a pass the engine stops on the way up is sent by a later one', async () => {
    const held = await hangingDevice()
    const { made, hung } = held
    const before = entryOf(made, 'p.png').file_key
    const { passing } = await stoppedOnTheWay(held)
    made.engine.stop()
    hung.hanging = false
    hung.free()
    await passing

    await made.engine.pass(space)
    expect(entryOf(made, 'p.png').file_key).not.toBe(before)
    expect(entryOf(made, 'p.png').mtime).toBe(123)
  })

  test('killed on the way up, the launch after reads it and sends it', async () => {
    const held = await hangingDevice()
    const { made } = held
    const before = entryOf(made, 'p.png').file_key
    const { path } = await stoppedOnTheWay(held)

    const k = await kit()
    const again = await k.Engine.start(made.engine.core.world, made.store.open())
    const row = () =>
      [...(again.core.spaces.get(space)?.entries.values() ?? [])].find(
        (entry) => entry.name === 'p.png',
      ) as unknown as { file_key: string; mtime: number | null }
    held.hung.hanging = false
    expect(row().mtime).not.toBe(123)
    await again.foreign(path)
    await again.stamped(path, 123, 456)
    await again.pass(space)
    expect(row().file_key).not.toBe(before)
    expect(row().mtime).toBe(123)
  })

  test('in step, a stamp is written down, and the scan has nothing more to read', async () => {
    const laptop = await device('laptop', { 'v.bin': picture(3) })
    const path = `${laptop.root}/v.bin`
    await laptop.engine.pass(space)
    await laptop.engine.foreign(path)
    await laptop.engine.stamped(path, 55, 4096)
    await laptop.engine.pass(space)
    expect(entryOf(laptop, 'v.bin').mtime).toBe(55)
  })
})

describe('a file whose bytes the account lost', () => {
  afterEach(() => vi.useRealTimers())

  test('is sent again by the device that has it, and reaches the others', async () => {
    const laptop = await device('laptop', { 'Trip/photo.png': picture(5) })
    await passed(laptop)
    const digest = await crypto.subtle.digest('SHA-256', picture(5))
    const hash = [...new Uint8Array(digest)]
      .map((one) => one.toString(16).padStart(2, '0'))
      .join('')
    expect(env.db.prepare('select count(*) as many from blobs where hash = ?').get(hash)).toEqual({
      many: 1,
    })

    env.db.prepare('delete from blobs where hash = ?').run(hash)
    await env.NOTES.delete(`blobs/${hash}`)

    const phone = await device('phone')
    await passed(phone)
    expect(bytesAt(phone, 'Trip/photo.png')).toBeUndefined()

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000)
    await passed(laptop)
    expect(env.db.prepare('select count(*) as many from blobs where hash = ?').get(hash)).toEqual({
      many: 1,
    })

    await passed(phone)
    expect(bytesAt(phone, 'Trip/photo.png')).toEqual(picture(5))
  })
})

describe('an account too full for a file', () => {
  async function filling(files: Record<string, string | Uint8Array>) {
    const state = { full: false, status: 507 }
    const made = await (
      await kit()
    ).testDevice({
      fetch: async (request) => {
        if (state.full && request.method === 'PUT' && request.url.includes('/v2/blobs/'))
          return Response.json({ error: 'refused' }, { status: state.status })
        return await app.fetch(request, env)
      },
      token,
      name: 'laptop',
      files,
    })
    const core = made.engine.core
    await core.commit(core.addSpace(space, made.root, 'owner'))
    expect(await (await kit()).firstPass(core, core.spaces.get(space), null)).toBe(true)
    await passed(made)
    return { made, state }
  }

  afterEach(() => vi.restoreAllMocks())

  function later() {
    const real = Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 10 * 60_000)
  }

  test('keeps a new file back, says so, and the rest of the space still syncs', async () => {
    const { made, state } = await filling({ 'Plan.md': 'one' })
    const phone = await device('phone')
    await passed(phone)

    state.full = true
    await made.disk.writeBytes(`${made.root}/photo.png`, picture(3))
    await made.engine.created(`${made.root}/photo.png`, false)
    await made.disk.write(`${made.root}/Notes.md`, 'a new note')
    await made.engine.created(`${made.root}/Notes.md`, false, 'a new note')
    for (let round = 0; round < 2; round += 1) {
      const one = await made.engine.pass(space)
      expect(one?.finished).toBe(true)
      expect(one?.full).toBe(true)
      await rooms.settle()
    }
    await passed(phone)
    expect(phone.disk.files.get(`${phone.root}/Notes.md`)).toBe('a new note')
    expect(bytesAt(phone, 'photo.png')).toBeUndefined()
    expect(made.engine.core.spaces.get(space)?.outbox).toHaveLength(1)

    state.full = false
    expect((await made.engine.pass(space))?.full).toBe(true)
    later()
    const freed = await made.engine.pass(space)
    expect(freed?.full).toBe(false)
    await rooms.settle()
    await passed(phone)
    expect(bytesAt(phone, 'photo.png')).toEqual(picture(3))
  })

  test.each([
    ['moved into a new folder', 'G/photo.png'],
    ['moved into a new folder and renamed', 'G/pic.png'],
  ])('kept back and then %s, it lands there once there is room', async (_said, to) => {
    const { made, state } = await filling({ 'Plan.md': 'one' })
    const phone = await device('phone')
    await passed(phone)

    state.full = true
    await made.disk.writeBytes(`${made.root}/photo.png`, picture(3))
    await made.engine.created(`${made.root}/photo.png`, false)
    expect((await made.engine.pass(space))?.full).toBe(true)
    await made.disk.mkdir(`${made.root}/G`)
    await made.engine.created(`${made.root}/G`, true)
    await made.disk.move(`${made.root}/photo.png`, `${made.root}/G/photo.png`)
    await made.engine.moved(`${made.root}/photo.png`, `${made.root}/G/photo.png`)
    if (to !== 'G/photo.png') {
      await made.disk.move(`${made.root}/G/photo.png`, `${made.root}/${to}`)
      await made.engine.moved(`${made.root}/G/photo.png`, `${made.root}/${to}`)
    }
    expect((await made.engine.pass(space))?.full).toBe(true)
    await rooms.settle()

    state.full = false
    later()
    await passed(made, phone)
    for (const one of [made, phone]) {
      expect(bytesAt(one, to)).toEqual(picture(3))
      expect(bytesAt(one, 'photo.png')).toBeUndefined()
    }
    expect(made.engine.waiting(space)).toBe(false)
  })

  test('kept back, then changed here, its new bytes go at once rather than after the wait', async () => {
    const { made, state } = await filling({ 'Plan.md': 'one' })
    const phone = await device('phone')
    await passed(phone)

    state.full = true
    await made.disk.writeBytes(`${made.root}/photo.png`, picture(3))
    await made.engine.created(`${made.root}/photo.png`, false)
    expect((await made.engine.pass(space))?.full).toBe(true)

    state.full = false
    await made.disk.writeBytes(`${made.root}/photo.png`, picture(7))
    await made.engine.foreign(`${made.root}/photo.png`)
    await passed(made, phone)
    expect(bytesAt(phone, 'photo.png')).toEqual(picture(7))
  })

  test('bytes refused for another reason wait too, said once in the log and not as full', async () => {
    const { made, state } = await filling({ 'Plan.md': 'one' })
    state.full = true
    state.status = 400
    await made.disk.writeBytes(`${made.root}/photo.png`, picture(3))
    await made.engine.created(`${made.root}/photo.png`, false)
    for (let round = 0; round < 2; round += 1) {
      const one = await made.engine.pass(space)
      expect(one?.finished).toBe(true)
      expect(one?.full).toBe(false)
    }
    const said = made.store.rows('log').filter((row) => row.failed?.includes('photo.png'))
    expect(said.map((row) => row.failed)).toEqual(['the account would not take photo.png'])
    expect(made.engine.core.spaces.get(space)?.outbox).toHaveLength(1)
  })

  test('keeps a replacement back, and the rest of the space still syncs', async () => {
    const { made, state } = await filling({ 'photo.png': picture(3) })
    const phone = await device('phone')
    await passed(phone)

    state.full = true
    await made.disk.writeBytes(`${made.root}/photo.png`, picture(5))
    await made.engine.foreign(`${made.root}/photo.png`)
    await made.disk.write(`${made.root}/Notes.md`, 'a new note')
    await made.engine.created(`${made.root}/Notes.md`, false, 'a new note')
    const one = await made.engine.pass(space)
    expect(one?.finished).toBe(true)
    expect(one?.full).toBe(true)
    await rooms.settle()
    await passed(phone)
    expect(phone.disk.files.get(`${phone.root}/Notes.md`)).toBe('a new note')
    expect(bytesAt(phone, 'photo.png')).toEqual(picture(3))

    state.full = false
    later()
    await passed(made, phone)
    expect(made.engine.held.notes).toHaveLength(0)
    expect(bytesAt(phone, 'photo.png')).toEqual(picture(5))
  })
})

describe('a file in a space this account may only read', () => {
  async function reader(): Promise<Device> {
    const theirs = await signIn(env, 'reader@example.com')
    env.db
      .prepare(
        "insert into space_members (space_id, email, role, created_at) values (?, 'reader@example.com', 'read', 1)",
      )
      .run(space)
    return await device('reader', {}, { token: theirs, role: 'read' })
  }

  function trashed(one: Device): string[] {
    const taken: string[] = []
    const remove = one.disk.remove.bind(one.disk)
    one.disk.remove = async (path) => {
      taken.push(path)
      await remove(path)
    }
    return taken
  }

  test('changed by another program, goes to the trash, the owner’s bytes come back, and the pass goes on', async () => {
    const owner = await device('laptop', { 'photo.png': picture(3), 'a.md': 'one\n' })
    const here = await reader()
    await passed(owner, here)
    expect(bytesAt(here, 'photo.png')).toEqual(picture(3))

    await owner.disk.write(`${owner.root}/a.md`, 'one\ntwo\n')
    await owner.engine.foreign(`${owner.root}/a.md`)
    await owner.engine.pass(space)
    await rooms.settle()

    const taken = trashed(here)
    await here.disk.writeBytes(`${here.root}/photo.png`, picture(10))
    await here.engine.foreign(`${here.root}/photo.png`)
    expect((await here.engine.pass(space))?.finished).toBe(true)
    await rooms.settle()

    expect(taken).toContain(`${here.root}/photo.png`)
    expect(bytesAt(here, 'photo.png')).toEqual(picture(3))
    expect(here.disk.files.get(`${here.root}/a.md`)).toBe('one\ntwo\n')
  })

  test('changed by another program and locked, waits for the next pass and the pass goes on', async () => {
    const owner = await device('laptop', { 'photo.png': picture(3), 'a.md': 'one\n' })
    const here = await reader()
    await passed(owner, here)

    await owner.disk.write(`${owner.root}/a.md`, 'one\ntwo\n')
    await owner.engine.foreign(`${owner.root}/a.md`)
    await owner.engine.pass(space)
    await rooms.settle()

    const remove = here.disk.remove.bind(here.disk)
    here.disk.remove = () => Promise.reject(new Error('the file is being used by another process'))
    await here.disk.writeBytes(`${here.root}/photo.png`, picture(10))
    await here.engine.foreign(`${here.root}/photo.png`)
    expect((await here.engine.pass(space))?.finished).toBe(true)
    await rooms.settle()
    expect(here.disk.files.get(`${here.root}/a.md`)).toBe('one\ntwo\n')
    expect(bytesAt(here, 'photo.png')).toEqual(picture(10))

    here.disk.remove = remove
    await here.engine.pass(space)
    await rooms.settle()
    expect(bytesAt(here, 'photo.png')).toEqual(picture(3))
  })

  test('made by another program, stays on this disk as it is and is not asked about again', async () => {
    const owner = await device('laptop', { 'a.md': 'one\n' })
    const here = await reader()
    await passed(owner, here)

    const taken = trashed(here)
    await here.disk.writeBytes(`${here.root}/mine.png`, picture(9))
    await here.engine.created(`${here.root}/mine.png`, false)
    await here.disk.write(`${here.root}/mine.md`, 'my words\n')
    await here.engine.created(`${here.root}/mine.md`, false)
    for (let round = 0; round < 3; round += 1) {
      expect((await here.engine.pass(space))?.finished).toBe(true)
      await rooms.settle()
    }

    expect(taken).toEqual([])
    expect(bytesAt(here, 'mine.png')).toEqual(picture(9))
    expect(here.disk.files.get(`${here.root}/mine.md`)).toBe('my words\n')
    const theirs = here.engine.core.spaces.get(space)
    expect(theirs?.outbox).toEqual([])
    expect([...(theirs?.entries.values() ?? [])].map((entry) => entry.name)).toEqual(['a.md'])
  })
})
