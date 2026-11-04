import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { NibdFrame } from '@orden/online/wire'
import { Nibd } from './nibd'

const made: { nibd: Nibd; state: string }[] = []
afterEach(() => {
  for (const { nibd, state } of made.splice(0)) {
    nibd.stop()
    rmSync(state, { recursive: true, force: true })
  }
})

/** A `nibd` with no session yet, whose callbacks are answered by `call`. */
function machine(
  call: (url: string) => Promise<number> = () => Promise.resolve(200),
  restart?: () => void,
) {
  const state = mkdtempSync(join(tmpdir(), 'nibd-state-'))
  const nibd = new Nibd({
    state,
    home: state,
    shell: '/bin/sh',
    user: null,
    env: {},
    pidsMax: 64,
    cgroups: null,
    activityEvery: 60_000,
    homeEvery: 60_000,
    // No test here starts a shell.
    holder: '',
    call,
    ...(restart ? { restart } : {}),
  })
  made.push({ nibd, state })
  const said: NibdFrame[] = []
  return { nibd, said, attach: () => nibd.attach((frame) => said.push(frame)) }
}

test('a callback is made on the machine and answered with its status', async () => {
  const asked: string[] = []
  const { nibd, said, attach } = machine((url) => {
    asked.push(url)
    return Promise.resolve(302)
  })
  attach()
  const url = 'http://localhost:54545/callback?code=c'
  await nibd.receive({ t: 'callback', session: 's_1', url })
  expect(asked).toEqual([url])
  expect(said).toEqual([{ t: 'called', session: 's_1', url, status: 302 }])
})

test('a callback anywhere but this machine is never made', async () => {
  const asked: string[] = []
  const { nibd, said, attach } = machine((url) => {
    asked.push(url)
    return Promise.resolve(200)
  })
  attach()
  await nibd.receive({ t: 'callback', session: 's_1', url: 'http://169.254.169.254:80/' })
  expect(asked).toEqual([])
  expect(said).toEqual([])
})

test('opens nothing with no link to say it on, or no session to say it for', () => {
  const { nibd, said, attach } = machine()
  expect(nibd.open('https://a.b/', 's_1')).toBe(false)
  attach()
  expect(nibd.open('https://a.b/', 's_1')).toBe(false)
  expect(said).toEqual([])
})

test('restart saves every screen and hands nibd to its supervisor, saying nothing', async () => {
  let restarted = 0
  const { nibd, said, attach } = machine(undefined, () => {
    restarted += 1
  })
  attach()
  await nibd.receive({ t: 'restart' })
  expect(restarted).toBe(1)
  expect(said).toEqual([])
})

test('a pasted picture is answered with where it was written, once its last part is here', async () => {
  const { nibd, said, attach } = machine()
  attach()
  const id = '0123456789abcdef0123'
  const part = (value: number, last: boolean) =>
    nibd.receive({
      t: 'image',
      session: 's_1',
      id,
      kind: 'png',
      data: new Uint8Array([value]),
      last,
    })
  await part(1, false)
  expect(said).toEqual([])
  await part(2, true)
  expect(said).toEqual([
    {
      t: 'image',
      session: 's_1',
      id,
      // Either separator: the machine's is `/`, a developer's computer may say `\`.
      path: expect.stringMatching(
        /\.cache[\\/]nib[\\/]images[\\/]0123456789abcdef0123\.png$/,
      ) as string,
    },
  ])
})

test('every report says the disk the home is on', () => {
  const { nibd } = machine()
  const disk = nibd.activity().disk
  expect(disk?.total).toBeGreaterThan(0)
  expect(disk?.used).toBeLessThanOrEqual(disk?.total ?? 0)
})

test('asked for its sessions, answers every one it has: none yet', async () => {
  const { nibd, said, attach } = machine()
  attach()
  await nibd.receive({ t: 'list' })
  expect(said).toEqual([{ t: 'sessions', sessions: [] }])
})

test('a watcher’s open starts no shell on a session nothing holds', async () => {
  const { nibd, attach } = machine()
  attach()
  const held = nibd as unknown as { sessions: Map<string, unknown> }
  await nibd.receive({ t: 'open', session: 's_none', cols: 80, rows: 24, watching: true })
  expect(held.sessions.has('s_none')).toBe(false)
})

test('a watcher’s open finds a program still running in its holder', async () => {
  const { nibd, attach } = machine()
  attach()
  const inner = nibd as unknown as {
    sessions: Map<string, unknown>
    holderOf: (id: string) => Promise<{ alive: boolean } | null>
    session: (id: string) => unknown
  }
  inner.holderOf = () => Promise.resolve({ alive: true })
  inner.session = () => ({ alive: true, detach: () => undefined })
  await nibd.receive({ t: 'open', session: 's_held', cols: 80, rows: 24, watching: true })
  expect(inner.sessions.has('s_held')).toBe(true)
})

test('a want right behind a watcher’s open is not lost while the holder is asked', async () => {
  const { nibd, attach } = machine()
  attach()
  const inner = nibd as unknown as {
    holderOf: (id: string) => Promise<{ alive: boolean } | null>
    session: (id: string) => unknown
  }
  let answer: (now: { alive: boolean }) => void = () => undefined
  inner.holderOf = () => new Promise((resolve) => (answer = resolve))
  const order: string[] = []
  inner.session = () => ({
    alive: true,
    detach: () => undefined,
    want: (since: number) => {
      order.push(`want ${String(since)}`)
      return Promise.resolve()
    },
    input: (data: string) => order.push(`in ${data}`),
  })
  const open = nibd.receive({ t: 'open', session: 's_held', cols: 80, rows: 24, watching: true })
  const want = nibd.receive({ t: 'want', session: 's_held', since: 7 })
  const typed = nibd.receive({ t: 'in', session: 's_held', data: 'x' })
  answer({ alive: true })
  await Promise.all([open, want, typed])
  expect(order).toEqual(['want 7', 'in x'])
})

test('a want behind an open that finds nothing is nothing, and frames after it go on', async () => {
  const { nibd, attach } = machine()
  attach()
  const inner = nibd as unknown as {
    holderOf: (id: string) => Promise<{ alive: boolean } | null>
    opening: Map<string, unknown>
  }
  inner.holderOf = () => Promise.reject(new Error('no socket'))
  await expect(
    nibd.receive({ t: 'open', session: 's_none', cols: 80, rows: 24, watching: true }),
  ).rejects.toThrow('no socket')
  await nibd.receive({ t: 'want', session: 's_none', since: 0 })
  expect(inner.opening.size).toBe(0)
})

test('an ended session is started again by an open, but not by a watcher’s', async () => {
  const { nibd, attach } = machine()
  attach()
  let restarted = 0
  const ended = { alive: false, restart: () => (restarted += 1), detach: () => undefined }
  ;(nibd as unknown as { sessions: Map<string, unknown> }).sessions.set('s_1', ended)
  const open = { t: 'open', session: 's_1', cols: 80, rows: 24 } as const
  await nibd.receive({ ...open, watching: true })
  expect(restarted).toBe(0)
  await nibd.receive(open)
  expect(restarted).toBe(1)
})
