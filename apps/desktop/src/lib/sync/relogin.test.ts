import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Signing out, writing, and signing back in, on fake devices against the real
 *  Worker: the service's own routes over real SQL (services/sync/test/harness.ts),
 *  reached through the app's own client, with a disk per device in memory. One test
 *  per row of the table in docs/sync.md, "Signing back in".
 *
 *  Every row holds the same three things: whether signing in asks, that no word
 *  either side wrote is lost, and that no copy appears beside a note where nothing
 *  overlapped. */

const world = vi.hoisted(() => {
  interface Entry {
    name: string
    path: string
    is_dir: boolean
    modified: number
    created: number
    children: Entry[]
  }

  /** One machine: its files, and the versions its saves kept of each. */
  class Device {
    disk = new Map<string, string>()
    kept = new Map<string, string[]>()

    keep(path: string, content: string) {
      if (!content.trim()) return
      const held = this.kept.get(path) ?? []
      if (held.at(-1) !== content) this.kept.set(path, [...held, content])
    }
  }

  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  let here = new Device()

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)
    const answer = (value: unknown) => Promise.resolve(value as T)

    switch (command) {
      case 'read_note': {
        const held = here.disk.get(path)
        return held === undefined ? Promise.reject(new Error(`no ${path}`)) : answer(held)
      }
      case 'write_note':
        here.disk.set(path, text(args.content))
        return answer(undefined)
      case 'snapshot_note':
        here.keep(path, text(args.content))
        return answer(undefined)
      case 'list_snapshots':
        return answer(
          [...(here.kept.get(path) ?? [])]
            .map((_, at) => ({ path: `${path}#${at}`, taken_at: at, size: 0 }))
            .reverse(),
        )
      case 'read_snapshot': {
        const [note = '', at = ''] = path.split('#')
        return answer(here.kept.get(note)?.[Number(at)] ?? '')
      }
      case 'file_stamp': {
        const held = here.disk.get(path)
        return answer(held === undefined ? null : { modified: 0, len: held.length })
      }
      case 'trash_item':
        here.disk.delete(path)
        return answer(undefined)
      case 'read_tree': {
        const root = text(args.root)
        const children = [...here.disk.keys()]
          .filter((one) => one.startsWith(`${root}/`))
          .sort()
          .map((one): Entry => ({
            name: one.split('/').pop() ?? one,
            path: one,
            is_dir: false,
            modified: 0,
            created: 0,
            children: [],
          }))
        return answer({ name: root, path: root, is_dir: true, modified: 0, created: 0, children })
      }
    }
    throw new Error(`no such command: ${command}`)
  }

  return {
    Device,
    invoke,
    use: (device: Device) => (here = device),
  }
})

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: world.invoke,
}))

/** The Worker and its test harness, out of services/sync. Named through a variable so
 *  the app's type check, which holds the app to the browser's types, does not walk
 *  into a Worker held to Cloudflare's; the shapes this file uses are spelled below. */
const SERVICE = new URL('../../../../../services/sync/', import.meta.url).href
interface Env {
  db: { exec(sql: string): void }
  close(): void
}
interface Answer<T> {
  status: number
  json: T
}
interface Harness {
  testEnv: () => Env
  signIn: (env: Env, email: string) => Promise<string>
  call: <T>(
    env: Env,
    path: string,
    options?: { token?: string; body?: unknown; method?: string },
  ) => Promise<Answer<T>>
}
interface Worker {
  default: { fetch(request: Request, env: Env): Promise<Response> }
}
const { default: worker } = (await import(/* @vite-ignore */ `${SERVICE}src/index.ts`)) as Worker
const { call, signIn, testEnv } = (await import(
  /* @vite-ignore */ `${SERVICE}test/harness.ts`
)) as Harness
const { newMirror, readMirror } = await import('./mirror')
const { pull, push } = await import('./pass')
const { meeting } = await import('./meeting')
const { asksOnReturn, baseFor } = await import('./returning')
const { savedRecord } = await import('./mirror')
type Mirror = import('./mirror').Mirror
type Device = InstanceType<typeof world.Device>

const NOBODY = new Set<string>()
const ROOT = '/Plans'
const NOTE = `${ROOT}/plan.md`
const COPY = 'from another device'

let env: Env

beforeEach(() => {
  env = testEnv()
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    worker.fetch(new Request(url, init), env),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

/** A person: a session on the account, and the id it is known by. */
async function person(email: string) {
  const token = await signIn(env, email)
  const me = await call<{ user?: { id: string } }>(env, '/v1/me', { token })
  return { token, id: me.json.user?.id ?? '' }
}

async function spaceOf(token: string, name = 'Plans'): Promise<string> {
  const made = await call<{ space?: { id: string } }>(env, '/v1/spaces', {
    token,
    body: { name },
  })
  return made.json.space?.id ?? ''
}

/** One pass, as sync.svelte.ts runs it: take what the account has, then offer. */
async function pass(device: Device, mirror: Mirror, token: string) {
  world.use(device)
  await pull(mirror, token, NOBODY)
  await push(mirror, token, NOBODY)
}

/** A keystroke and the save after it, which keeps the words it replaces first, as
 *  workspace/saving.svelte.ts does. */
function types(device: Device, path: string, content: string) {
  device.keep(path, device.disk.get(path) ?? '')
  device.disk.set(path, content)
}

/** What the record a sign-out leaves behind reads as on the next launch. */
function storedThrough(mirror: Mirror, whose: string) {
  const written: unknown = JSON.parse(
    JSON.stringify({ account: whose, seen: true, mirrors: { [mirror.root]: mirror } }),
  )
  const saved = savedRecord(written)
  const back = readMirror(mirror.root, saved?.mirrors[mirror.root])
  if (!saved || !back) throw new Error('the record no longer reads')
  return { saved, mirror: back }
}

/** The account's copy of the only note at `path` in a space. */
async function accountHolds(token: string, spaceId: string, path = 'plan.md') {
  const page = await call<{ notes: { id: string; path: string; deleted: boolean }[] }>(
    env,
    `/v1/spaces/${spaceId}/changes?since=0`,
    { token },
  )
  const live = page.json.notes.filter((one) => !one.deleted)
  const note = live.find((one) => one.path === path)
  const body = note
    ? await call<{ content: string; note: { version: number } }>(env, `/v1/notes/${note.id}`, {
        token,
      })
    : null
  return { paths: live.map((one) => one.path).sort(), id: note?.id ?? '', ...body?.json }
}

/** Another device of the same person writing on the account: a whole new body on top
 *  of the version it read. */
async function elsewhere(token: string, spaceId: string, content: string) {
  const held = await accountHolds(token, spaceId)
  await call(env, `/v1/notes/${held.id}`, {
    method: 'PUT',
    token,
    body: { content, baseVersion: held.note?.version ?? 0 },
  })
}

/** Whether signing in on `device` asks, as settling.ts decides it. */
async function asks(
  device: Device,
  token: string,
  id: string,
  saved: Parameters<typeof baseFor>[0],
): Promise<boolean> {
  world.use(device)
  const base = baseFor(saved, id)
  if (base === 'mine') return false
  const listed = await call<{ spaces: { id: string; name: string; role: string }[] }>(
    env,
    '/v1/spaces',
    { token },
  )
  const met = await meeting(token, [{ name: 'Plans', root: ROOT }], listed.json.spaces)
  return asksOnReturn(base, met.length > 0)
}

/** A device that synced `content` with the account and then signed out. */
async function syncedThenSignedOut(content: string) {
  const me = await person('me@nib.dev')
  const spaceId = await spaceOf(me.token)
  const laptop = new world.Device()
  laptop.disk.set(NOTE, content)
  const mirror = newMirror(spaceId, ROOT)
  await pass(laptop, mirror, me.token)

  // Signing out ends the session on the account; the record stays on the device.
  await call(env, '/v1/auth/signout', { token: me.token, body: {} })
  return { me, spaceId, laptop, ...storedThrough(mirror, me.id) }
}

/** Five minutes on, so the account keeps the next write as a version of its own. */
function later() {
  env.db.exec('update note_versions set at = at - 600000')
}

describe('signing back in to the same account', () => {
  test('untouched here, written there: the account’s words come down, nothing asked', async () => {
    const { me, spaceId, laptop, saved, mirror } = await syncedThenSignedOut('# Plan\n\none\n')
    await elsewhere((await person('me@nib.dev')).token, spaceId, '# Plan\n\none\ntwo\n')

    const back = await person('me@nib.dev')
    expect(back.id).toBe(me.id)
    expect(await asks(laptop, back.token, back.id, saved)).toBe(false)

    await pass(laptop, mirror, back.token)
    expect(laptop.disk.get(NOTE)).toBe('# Plan\n\none\ntwo\n')
    expect([...laptop.disk.keys()].filter((one) => one.includes(COPY))).toEqual([])
  })

  test('written here while signed out, untouched there: they go up, nothing asked', async () => {
    const { spaceId, laptop, saved, mirror } = await syncedThenSignedOut('# Plan\n\none\n')
    types(laptop, NOTE, '# Plan\n\none\noffline\n')

    const back = await person('me@nib.dev')
    expect(await asks(laptop, back.token, back.id, saved)).toBe(false)

    await pass(laptop, mirror, back.token)
    expect((await accountHolds(back.token, spaceId)).content).toBe('# Plan\n\none\noffline\n')
    expect([...laptop.disk.keys()].filter((one) => one.includes(COPY))).toEqual([])
  })

  test('written on both, apart: one note with both, nothing asked, no copy', async () => {
    const start = '# Plan\n\nfirst line\n\nsecond line\n'
    const { spaceId, laptop, saved, mirror } = await syncedThenSignedOut(start)
    types(laptop, NOTE, '# Plan\n\nfirst line, here\n\nsecond line\n')
    await elsewhere((await person('me@nib.dev')).token, spaceId, `${start}\nthird, there\n`)

    const back = await person('me@nib.dev')
    expect(await asks(laptop, back.token, back.id, saved)).toBe(false)

    await pass(laptop, mirror, back.token)
    const merged = '# Plan\n\nfirst line, here\n\nsecond line\n\nthird, there\n'
    expect(laptop.disk.get(NOTE)).toBe(merged)
    expect((await accountHolds(back.token, spaceId)).content).toBe(merged)
    expect([...laptop.disk.keys()].filter((one) => one.includes(COPY))).toEqual([])
  })

  test('and merged against the account’s version when this device kept none', async () => {
    const start = '# Plan\n\nfirst line\n\nsecond line\n'
    const { spaceId, laptop, saved, mirror } = await syncedThenSignedOut(start)
    later()
    // Written by something that keeps no version of its own: another editor.
    laptop.disk.set(NOTE, '# Plan\n\nfirst line, here\n\nsecond line\n')
    laptop.kept.clear()
    await elsewhere((await person('me@nib.dev')).token, spaceId, `${start}\nthird, there\n`)

    const back = await person('me@nib.dev')
    expect(await asks(laptop, back.token, back.id, saved)).toBe(false)

    await pass(laptop, mirror, back.token)
    expect(laptop.disk.get(NOTE)).toBe(
      '# Plan\n\nfirst line, here\n\nsecond line\n\nthird, there\n',
    )
    expect([...laptop.disk.keys()].filter((one) => one.includes(COPY))).toEqual([])
  })

  test('written on both, in the same sentence: the copy beside it holds the other', async () => {
    const start = '# Plan\n\nWe meet on Monday at the office to talk about the launch.\n'
    const { spaceId, laptop, saved, mirror } = await syncedThenSignedOut(start)
    const mine = '# Plan\n\nWe meet on Thursday at the station to argue about the price.\n'
    const theirs = '# Plan\n\nWe meet on Friday in the park to celebrate the release party.\n'
    types(laptop, NOTE, mine)
    await elsewhere((await person('me@nib.dev')).token, spaceId, theirs)

    const back = await person('me@nib.dev')
    expect(await asks(laptop, back.token, back.id, saved)).toBe(false)

    await pass(laptop, mirror, back.token)
    expect(laptop.disk.get(NOTE)).toBe(mine)
    const copies = [...laptop.disk.entries()].filter(([path]) => path.includes(COPY))
    expect(copies.map(([, words]) => words)).toEqual([theirs])
  })
})

describe('signing in with notes of unknown standing', () => {
  test('another account’s, meeting other words at one path: asks', async () => {
    const { laptop, saved } = await syncedThenSignedOut('# Plan\n\nmine\n')
    const other = await person('other@nib.dev')
    const theirs = await spaceOf(other.token)
    await call(env, `/v1/spaces/${theirs}/notes`, {
      token: other.token,
      body: { path: 'plan.md', content: '# Plan\n\ntheirs\n' },
    })

    expect(await asks(laptop, other.token, other.id, saved)).toBe(true)
  })

  test('another account’s, meeting nothing: joins without a word', async () => {
    const { laptop, saved } = await syncedThenSignedOut('# Plan\n\nmine\n')
    const other = await person('other@nib.dev')

    expect(await asks(laptop, other.token, other.id, saved)).toBe(false)
  })

  test('no record, other words at one path: asks', async () => {
    const me = await person('me@nib.dev')
    const spaceId = await spaceOf(me.token)
    await call(env, `/v1/spaces/${spaceId}/notes`, {
      token: me.token,
      body: { path: 'plan.md', content: '# Plan\n\nthe account’s\n' },
    })
    const fresh = new world.Device()
    fresh.disk.set(NOTE, '# Plan\n\nthis device’s\n')

    expect(await asks(fresh, me.token, me.id, null)).toBe(true)
  })

  test('no record, an older copy of the account’s note: brought up to date, nothing asked', async () => {
    const { spaceId, laptop } = await syncedThenSignedOut('# Plan\n\none\n')
    later()
    await elsewhere((await person('me@nib.dev')).token, spaceId, '# Plan\n\none\ntwo\n')

    // The record went (a browser's storage cleared), the files stayed.
    const back = await person('me@nib.dev')
    expect(await asks(laptop, back.token, back.id, null)).toBe(false)

    await pass(laptop, newMirror(spaceId, ROOT), back.token)
    expect(laptop.disk.get(NOTE)).toBe('# Plan\n\none\ntwo\n')
    expect([...laptop.disk.keys()].filter((one) => one.includes(COPY))).toEqual([])
  })

  test('no record, the same words: paired, nothing asked', async () => {
    const { spaceId, laptop } = await syncedThenSignedOut('# Plan\n\none\n')
    const back = await person('me@nib.dev')
    expect(await asks(laptop, back.token, back.id, null)).toBe(false)

    const mirror = newMirror(spaceId, ROOT)
    await pass(laptop, mirror, back.token)
    expect(mirror.notes['plan.md']?.id).toBe((await accountHolds(back.token, spaceId)).id)
    expect((await accountHolds(back.token, spaceId)).paths).toEqual(['plan.md'])
  })
})

describe('signing in on a device that holds nothing', () => {
  test('downloads the account, nothing asked', async () => {
    const me = await person('me@nib.dev')
    const spaceId = await spaceOf(me.token)
    await call(env, `/v1/spaces/${spaceId}/notes`, {
      token: me.token,
      body: { path: 'plan.md', content: '# Plan\n' },
    })
    const wiped = new world.Device()

    expect(await asks(wiped, me.token, me.id, null)).toBe(false)
    await pass(wiped, newMirror(spaceId, ROOT), me.token)
    expect(wiped.disk.get(NOTE)).toBe('# Plan\n')
  })
})
