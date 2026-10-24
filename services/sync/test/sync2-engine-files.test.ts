/** Files that are not documents under sync v2, the app's engine against this Worker (docs/sync-v2.md
 *  section 5.8): a picture made on one device reaches another as its bytes, a
 *  replacement follows it, two replacements made apart ask rather than one quietly
 *  winning, and a delete takes it away everywhere.
 *
 *  The devices are the app's own engine (apps/desktop/src/lib/sync2/test-device.ts),
 *  reached by its path for the reason sync2-engine.test.ts gives. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import app from '../src/index'
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
  disk: {
    bytes: Map<string, Uint8Array>
    files: Map<string, string>
    writeBytes(path: string, bytes: Uint8Array): Promise<void>
    write(path: string, text: string): Promise<void>
    remove(path: string): Promise<void>
  }
  engine: {
    core: Core
    pass(space: string): Promise<{ finished: boolean } | null>
    created(path: string, dir: boolean): Promise<string | null>
    foreign(path: string): Promise<void>
    removed(path: string): Promise<void>
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
}

async function kit(): Promise<Kit> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync2/${file}`, import.meta.url).href
  const [device, migrate] = await Promise.all([
    import(/* @vite-ignore */ at('test-device.ts')),
    import(/* @vite-ignore */ at('migrate.ts')),
  ])
  return { ...(device as object), ...(migrate as object) } as Kit
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

    // The feed names its own bytes before the file is read again: nothing to ask.
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

    // The second to arrive is the one that asks, and nothing was written over.
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

describe('a file in a space this account may only read', () => {
  /** Somebody the space is shared with to read, on a device of their own. */
  async function reader(): Promise<Device> {
    const theirs = await signIn(env, 'reader@example.com')
    env.db
      .prepare(
        "insert into space_members (space_id, email, role, created_at) values (?, 'reader@example.com', 'read', 1)",
      )
      .run(space)
    return await device('reader', {}, { token: theirs, role: 'read' })
  }

  /** Every path the disk takes away, to this device's trash in the app. */
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
