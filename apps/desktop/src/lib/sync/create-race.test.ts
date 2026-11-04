import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Two devices meeting at one note inside the gap between a pull and a push, on fake
 *  devices against the real Worker (services/sync/test/harness.ts): nothing either wrote
 *  is lost, whichever way the account said so. */

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
    /** Folders that will not list, and whether the space itself will. */
    shut = new Set<string>()
    rootShut = false
    /** Paths the disk refuses a new file at, as a name too long for it. */
    refused = new Set<string>()
    /** And every conflict copy. */
    refusedCopies = false

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
        if (here.refusedCopies && path.includes('from another device')) {
          return Promise.reject(new Error(`refused ${path}`))
        }
        if (here.refused.has(path)) return Promise.reject(new Error(`refused ${path}`))
        // The crate's rule: no new file of a name Windows keeps, but for one that arrived.
        if (!here.disk.has(path) && /\/(con|aux)(\.[^/]*)?$/i.test(path) && args.arrived !== true) {
          return Promise.reject(new Error('a name Windows keeps'))
        }
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
      case 'delete_note':
        here.disk.delete(path)
        return answer(undefined)
      case 'read_file':
        return answer(new TextEncoder().encode(here.disk.get(path) ?? '').buffer)
      case 'read_tree': {
        const root = text(args.root)
        const shut = [...here.shut]
        const children = here.rootShut
          ? []
          : [
              ...[...here.disk.keys()]
                .filter(
                  (one) =>
                    one.startsWith(`${root}/`) &&
                    !shut.some((folder) => one.startsWith(`${folder}/`)),
                )
                .sort()
                .map((one): Entry => ({
                  name: one.split('/').pop() ?? one,
                  path: one,
                  is_dir: false,
                  modified: 0,
                  created: 0,
                  children: [],
                })),
              ...shut.map((one) => ({
                name: one,
                path: one,
                is_dir: true,
                modified: 0,
                created: 0,
                children: [],
                unlisted: true,
              })),
            ]
        return answer({
          name: root,
          path: root,
          is_dir: true,
          modified: 0,
          created: 0,
          children,
          ...(here.rootShut ? { unlisted: true } : {}),
        })
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
const { newMirror } = await import('./mirror')
const { pull, push } = await import('./pass')
type Mirror = import('./mirror').Mirror
type Device = InstanceType<typeof world.Device>

const NOBODY = new Set<string>()
const ROOT = '/Plans'
const NOTE = `${ROOT}/plan.md`
const COPY = 'from another device'
const INBOX = `${ROOT}/.Inbox.md`

let env: Env
/** What the account does otherwise than the Worker in this tree. */
let account = { wordless: false, readsAway: false, filesSaid: [] as string[] }

beforeEach(() => {
  env = testEnv()
  account = { wordless: false, readsAway: false, filesSaid: [] as string[] }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const asked = new Request(url, init)
    if (asked.method === 'PUT' && asked.url.endsWith('/files')) {
      const { files } = (await asked.clone().json()) as { files: { path: string }[] }
      account.filesSaid = files.map((one) => one.path)
    }
    if (account.readsAway && asked.method === 'GET' && /\/v1\/notes\/[^/]+$/.test(asked.url)) {
      return new Response('{"error":"away"}', { status: 503 })
    }
    const answer = await worker.fetch(asked, env)
    if (!account.wordless || answer.status !== 409) return answer
    // The answer as it was before the 409 of a create carried the note's words.
    const { note, error } = (await answer.json()) as { note: unknown; error: string }
    return new Response(JSON.stringify({ note, error }), { status: 409 })
  })
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

const copies = (device: Device) => [...device.disk.keys()].filter((path) => path.includes(COPY))
const sha = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/** A device that has pulled, and another note made at `path` before it pushes. */
async function meetingInTheGap(path: string, ours: string, theirs: string) {
  const me = await person('a@example.com')
  const spaceId = await spaceOf(me.token)
  const device = new world.Device()
  const mirror = newMirror(spaceId, ROOT)
  device.disk.set(`${ROOT}/${path}`, ours)
  world.use(device)
  await pull(mirror, me.token, NOBODY)
  await call(env, `/v1/spaces/${spaceId}/notes`, {
    token: me.token,
    body: { path, content: theirs },
  })
  return { me, spaceId, device, mirror }
}

describe('a create that meets a note made since the pull', () => {
  test('the other words stay, beside the ones written here', async () => {
    const { me, spaceId, device, mirror } = await meetingInTheGap(
      'plan.md',
      'words of A\n',
      'words of B, only here\n',
    )
    await push(mirror, me.token, NOBODY)

    expect(copies(device)).toHaveLength(1)
    expect(device.disk.get(copies(device)[0] ?? '')).toBe('words of B, only here\n')
    expect(device.disk.get(NOTE)).toBe('words of A\n')
    expect((await accountHolds(me.token, spaceId)).content).toBe('words of A\n')
  })

  test('the 409 itself carries the words, for an app already out there', async () => {
    const { me, spaceId } = await meetingInTheGap('plan.md', 'A\n', 'B\n')
    const again = await call<{ content?: string; note?: { id: string } }>(
      env,
      `/v1/spaces/${spaceId}/notes`,
      { token: me.token, body: { path: 'plan.md', content: 'A\n' } },
    )
    expect(again.status).toBe(409)
    expect(again.json.content).toBe('B\n')
    expect(again.json.note?.id).toBeTruthy()
  })

  test("the space's inbox keeps the tasks of both", async () => {
    const { me, spaceId, device, mirror } = await meetingInTheGap(
      '.Inbox.md',
      '- [ ] from A\n',
      '- [ ] from B\n',
    )
    await push(mirror, me.token, NOBODY)

    const held = await accountHolds(me.token, spaceId, '.Inbox.md')
    expect(held.content).toContain('- [ ] from A')
    expect(held.content).toContain('- [ ] from B')
    expect(device.disk.get(INBOX)).toContain('- [ ] from B')
  })

  test('a canvas keeps the cards of both', async () => {
    const card = (id: string) => ({ id, type: 'text', text: id, x: 0, y: 0, width: 9, height: 9 })
    const canvas = (id: string) => JSON.stringify({ nodes: [card(id)], edges: [] })
    const { me, spaceId, mirror } = await meetingInTheGap(
      'board.canvas',
      canvas('mine'),
      canvas('theirs'),
    )
    await push(mirror, me.token, NOBODY)

    const held = await accountHolds(me.token, spaceId, 'board.canvas')
    expect(held.content).toContain('"mine"')
    expect(held.content).toContain('"theirs"')
  })

  test('an account that sends no words is asked for them', async () => {
    const { me, device, mirror } = await meetingInTheGap('plan.md', 'A\n', 'B\n')
    account.wordless = true
    await push(mirror, me.token, NOBODY)
    expect(device.disk.get(copies(device)[0] ?? '')).toBe('B\n')
  })

  test('asked and not answered, nothing is written over, and the next pass asks again', async () => {
    const { me, spaceId, device, mirror } = await meetingInTheGap('plan.md', 'A\n', 'B\n')
    account.wordless = true
    account.readsAway = true
    await push(mirror, me.token, NOBODY)
    expect(mirror.notes['plan.md']).toBeUndefined()
    account.readsAway = false
    expect((await accountHolds(me.token, spaceId)).content).toBe('B\n')

    await push(mirror, me.token, NOBODY)
    const words = [device.disk.get(NOTE), device.disk.get(copies(device)[0] ?? '')].sort()
    expect(words).toEqual(['A\n', 'B\n'])
  })

  // Pull normally pairs first; a machine that lost the answer to its own create and
  // meets it here is the case the words on the account being its own says.
  test("this machine's own earlier create is paired, not copied", async () => {
    const { me, spaceId, device, mirror } = await meetingInTheGap(
      'plan.md',
      'written on since\n',
      'its own first words\n',
    )
    mirror.offered = { 'plan.md': await sha('its own first words\n') }
    await push(mirror, me.token, NOBODY)

    expect(copies(device)).toEqual([])
    expect(mirror.notes['plan.md']).toBeDefined()
    await push(mirror, me.token, NOBODY)
    expect((await accountHolds(me.token, spaceId)).content).toBe('written on since\n')
    expect(copies(device)).toEqual([])
  })
})

describe('a write refused for a rename made elsewhere', () => {
  test('the note stays at the name the account moved it to', async () => {
    const me = await person('c@example.com')
    const spaceId = await spaceOf(me.token)
    const device = new world.Device()
    device.disk.set(NOTE, 'first\n')
    const mirror = newMirror(spaceId, ROOT)
    await pass(device, mirror, me.token)
    const held = await accountHolds(me.token, spaceId)

    // Elsewhere: renamed, after this device's pull of the round.
    await call(env, `/v1/notes/${held.id}`, {
      method: 'PUT',
      token: me.token,
      body: { content: 'first\nelsewhere\n', baseVersion: held.note?.version, path: 'renamed.md' },
    })
    device.disk.set(NOTE, 'first\nhere\n')
    world.use(device)
    await push(mirror, me.token, NOBODY)

    const after = await accountHolds(me.token, spaceId, 'renamed.md')
    expect(after.paths).toEqual(['renamed.md'])
    expect(after.content).toContain('here')
    expect(after.content).toContain('elsewhere')
  })
})

describe('a folder that will not list', () => {
  async function synced() {
    const me = await person('d@example.com')
    const spaceId = await spaceOf(me.token)
    const device = new world.Device()
    device.disk.set(`${ROOT}/shut/inside.md`, 'inside\n')
    device.disk.set(`${ROOT}/shutter.md`, 'beside\n')
    device.disk.set(NOTE, 'open\n')
    const mirror = newMirror(spaceId, ROOT)
    await pass(device, mirror, me.token)
    return { me, spaceId, device, mirror }
  }

  test('nothing under it is deleted, and it is still known', async () => {
    const { me, spaceId, device, mirror } = await synced()
    device.shut.add(`${ROOT}/shut`)
    await push(mirror, me.token, NOBODY)
    expect((await accountHolds(me.token, spaceId)).paths).toEqual([
      'plan.md',
      'shut/inside.md',
      'shutter.md',
    ])
    expect(mirror.notes['shut/inside.md']).toBeDefined()
  })

  test('a note beside it that did go is still a delete', async () => {
    const { me, spaceId, device, mirror } = await synced()
    device.shut.add(`${ROOT}/shut`)
    device.disk.delete(`${ROOT}/shutter.md`)
    await push(mirror, me.token, NOBODY)
    expect((await accountHolds(me.token, spaceId)).paths).toEqual(['plan.md', 'shut/inside.md'])
  })

  test('a space that will not list deletes nothing', async () => {
    const { me, spaceId, device, mirror } = await synced()
    device.rootShut = true
    await push(mirror, me.token, NOBODY)
    expect((await accountHolds(me.token, spaceId)).paths).toHaveLength(3)
  })
})

describe('a note the disk refuses on v1', () => {
  async function arrivals(...paths: string[]) {
    const me = await person('e@example.com')
    const spaceId = await spaceOf(me.token)
    for (const path of paths) {
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: me.token,
        body: { path, content: `words of ${path}\n` },
      })
    }
    return { me, spaceId, device: new world.Device(), mirror: newMirror(spaceId, ROOT) }
  }

  test('the rest of the page lands, the cursor waits, and it lands once it can', async () => {
    const { me, device, mirror } = await arrivals('a.md', 'blocked.md', 'z.md')
    device.refused.add(`${ROOT}/blocked.md`)
    world.use(device)
    const told: string[] = []
    await pull(mirror, me.token, NOBODY, { notWritten: (path) => told.push(path) })
    expect(told).toEqual(['blocked.md'])
    expect(device.disk.get(`${ROOT}/a.md`)).toBe('words of a.md\n')
    expect(device.disk.get(`${ROOT}/z.md`)).toBe('words of z.md\n')
    expect(mirror.cursor).toBe(0)
    expect(mirror.notes['blocked.md']).toBeUndefined()

    device.refused.clear()
    await pull(mirror, me.token, NOBODY)
    expect(device.disk.get(`${ROOT}/blocked.md`)).toBe('words of blocked.md\n')
    expect(mirror.cursor).toBeGreaterThan(0)
  })

  test('and the push of the same pass goes on: it comes back as nothing new', async () => {
    const { me, spaceId, device, mirror } = await arrivals('blocked.md')
    device.refused.add(`${ROOT}/blocked.md`)
    device.disk.set(`${ROOT}/mine.md`, 'mine\n')
    await pass(device, mirror, me.token)
    const held = await accountHolds(me.token, spaceId)
    expect(held.paths).toEqual(['blocked.md', 'mine.md'])
  })

  test('a name Windows keeps lands under that name, and is the note', async () => {
    const { me, spaceId, device, mirror } = await arrivals('Con.md')
    await pass(device, mirror, me.token)
    expect(device.disk.get(`${ROOT}/Con.md`)).toBe('words of Con.md\n')
    expect(mirror.notes['Con.md']).toBeDefined()
    await pass(device, mirror, me.token)
    expect((await accountHolds(me.token, spaceId)).paths).toEqual(['Con.md'])
  })

  test('a create whose copy the disk refuses stays unpaired, its words not written over', async () => {
    const { me, spaceId, device, mirror } = await meetingInTheGap('plan.md', 'A\n', 'B\n')
    device.refusedCopies = true
    await push(mirror, me.token, NOBODY)
    expect(mirror.notes['plan.md']).toBeUndefined()
    expect((await accountHolds(me.token, spaceId)).content).toBe('B\n')
    device.refusedCopies = false
    await push(mirror, me.token, NOBODY)
    expect(device.disk.get(copies(device)[0] ?? '')).toBe('B\n')
  })

  test('a delete told under a name no disk holds still takes the file it knew', async () => {
    const me = await person('f@example.com')
    const spaceId = await spaceOf(me.token)
    const device = new world.Device()
    device.disk.set(NOTE, 'first\n')
    const mirror = newMirror(spaceId, ROOT)
    await pass(device, mirror, me.token)
    const { id } = await accountHolds(me.token, spaceId)
    env.db.exec(
      `update notes set path = '${'x'.repeat(300)}.md', deleted = 1, deleted_at = 1,
                        seq = seq + 100 where id = '${id}'`,
    )
    world.use(device)
    await pull(mirror, me.token, NOBODY)
    expect(device.disk.has(NOTE)).toBe(false)
  })
})

describe('the files of a site under a folder that will not list', () => {
  test('stay on the list the account is told', async () => {
    const me = await person('g@example.com')
    const spaceId = await spaceOf(me.token)
    const device = new world.Device()
    device.disk.set(`${ROOT}/shut/paper.pdf`, 'bytes')
    device.disk.set(`${ROOT}/open.pdf`, 'other bytes')
    const mirror = newMirror(spaceId, ROOT)
    await pass(device, mirror, me.token)
    expect(Object.keys(mirror.files).sort()).toEqual(['open.pdf', 'shut/paper.pdf'])

    device.shut.add(`${ROOT}/shut`)
    device.disk.delete(`${ROOT}/open.pdf`)
    await push(mirror, me.token, NOBODY)
    expect(Object.keys(mirror.files)).toEqual(['shut/paper.pdf'])
    expect(account.filesSaid).toEqual(['shut/paper.pdf'])
  })
})
