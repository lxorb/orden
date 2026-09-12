import { beforeEach, afterEach, describe, expect, test } from 'vitest'

import { call, signIn, type TestEnv, testEnv } from './harness'
import { KEEP_FOR, sweepVersions, tooClose, versionKey } from '../src/versions'

interface VersionView {
  versions?: { at: number; size: number; by: string }[]
  at?: number
  content?: string
  notes?: number
  paths?: string[]
  more?: boolean
  error?: string
  note?: { id: string; version: number; path: string }
  space?: { id: string }
}

/** A version is only kept every five minutes, so a test that wants two of them
 *  moves the rows back rather than waiting. */
function agedBy(env: TestEnv, ms: number): void {
  env.db.exec(`update note_versions set at = at - ${ms}`)
}

/** The versions of one note. A fresh space arrives with a note in it already, so
 *  a count of every row in the table counts that one too. */
function rows(env: TestEnv, noteId: string): { at: number; hash: string; by: string }[] {
  return env.db
    .prepare('select at, hash, by from note_versions where note_id = ? order by at')
    .all(noteId) as never
}

describe('the account keeps what a note said', () => {
  let env: TestEnv
  let token: string
  let space: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''

    const wrote = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: '# One' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('from the moment it arrives', async () => {
    const held = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token })

    expect(held.status).toBe(200)
    expect(held.json.versions).toHaveLength(1)
    expect(env.keys()).toContain(versionKey(rows(env, note)[0]?.hash ?? ''))
  })

  test('and every push after it, at most one every five minutes', async () => {
    // Too soon: the note itself is the newest state, so a version of it says
    // nothing the file does not.
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Two', baseVersion: 1 },
    })

    expect(rows(env, note)).toHaveLength(1)

    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Three', baseVersion: 2 },
    })

    expect(rows(env, note)).toHaveLength(2)
  })

  test('but not the same words twice', async () => {
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# One', baseVersion: 1 },
    })

    expect(rows(env, note)).toHaveLength(1)
  })

  test('and one body however many notes say it', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'copy.md', content: '# One' },
    })

    // Both notes say the same five bytes, so both rows name one body.
    const said = env.db.prepare('select hash from note_versions where size = 5').all() as {
      hash: string
    }[]

    expect(said).toHaveLength(2)
    expect(new Set(said.map((one) => one.hash)).size).toBe(1)
    expect(env.keys().filter((key) => key === versionKey(said[0]?.hash ?? ''))).toHaveLength(1)
  })

  test('with the device that sent it, where it said', async () => {
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Four', baseVersion: 1 },
      headers: { 'x-nib-device': 'the laptop' },
    })

    const held = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token })
    expect(held.json.versions?.[0]?.by).toBe('the laptop')
  })

  test('and hands one back when asked for it', async () => {
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Five', baseVersion: 1 },
    })

    const list = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token })
    const oldest = list.json.versions?.at(-1)?.at ?? 0
    const said = await call<VersionView>(env, `/v1/notes/${note}/versions/${oldest}`, { token })

    expect(said.status).toBe(200)
    expect(said.json.content).toBe('# One')
  })

  test('refuses a moment it has no version at', async () => {
    const said = await call<VersionView>(env, `/v1/notes/${note}/versions/1`, { token })

    expect(said.status).toBe(404)
    expect(said.json.error).toBe('no such version')
  })

  test('and a note somebody else cannot reach', async () => {
    const other = await signIn(env, 'c@d.dev')
    const held = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token: other })

    expect(held.status).toBe(404)
  })

  test('and says so when the body a row names has gone', async () => {
    // A row whose body is missing is a version the account cannot answer, and
    // answering it with no words at all is worse than answering nothing: the
    // history sheet shows an empty note and restoring it writes that emptiness
    // over the words somebody still has.
    const at = rows(env, note)[0]?.at ?? 0
    await env.NOTES.delete(versionKey(rows(env, note)[0]?.hash ?? ''))

    const said = await call<VersionView>(env, `/v1/notes/${note}/versions/${at}`, { token })

    expect(said.status).toBe(404)
    expect(said.json.content).toBeUndefined()
  })

  test('and keeps a bounded number of them per note', async () => {
    // One every five minutes is two hundred and eighty-eight a day, and the
    // thinning that answers for that runs nightly with a write budget of four
    // hundred for the whole service. So a note written in all day outruns the
    // sweep, and the ceiling has to hold where the version is written.
    const insert = env.db.prepare(
      'insert into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
    )
    const oldest = Date.now() - MOST_KEPT * 5 * 60 * 1000
    for (let at = 0; at < MOST_KEPT; at++) {
      insert.run(note, oldest + at * 5 * 60 * 1000, `seeded-${at}`, 5, '')
    }

    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# one more', baseVersion: 1 },
    })

    const held = rows(env, note)
    expect(held.length).toBeLessThanOrEqual(MOST_KEPT)
    // What went is the oldest, and what arrived is there.
    expect(held.some((one) => one.hash === 'seeded-0')).toBe(false)
    expect(held.at(-1)?.at).toBeGreaterThan(oldest + (MOST_KEPT - 1) * 5 * 60 * 1000)
  })

  test('and the sweep keeps up with a busy day rather than falling behind it', async () => {
    // Two notes written in all day is more versions a day than the sweep's write
    // budget, so the month thinned to one an hour was a promise the nightly job
    // could not keep: the rows it could not reach stayed, and every night it
    // started the same distance behind.
    const insert = env.db.prepare(
      'insert into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
    )

    const other = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'other.md', content: 'other' },
    })
    const second = other.json.note?.id ?? ''

    // A day of saves each, two days back, so the thinning is what applies.
    const from = Date.now() - 2 * 24 * 60 * 60 * 1000
    for (const which of [note, second]) {
      for (let at = 0; at < 288; at++) {
        insert.run(which, from + at * 5 * 60 * 1000, `${which}-${at}`, 5, '')
      }
    }

    await sweepVersions(env, Date.now())

    // One an hour is what is left of a day of saves, for both notes.
    for (const which of [note, second]) {
      const kept = rows(env, which).filter((one) => one.at >= from && one.at < from + 24 * 60 * 60 * 1000)
      expect(kept.length).toBeLessThanOrEqual(24)
    }
  })
})

describe('putting a space back to a moment', () => {
  let env: TestEnv
  let token: string
  let space: string
  let first: string
  let second: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''

    const one = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Plans/one.md', content: 'the first words' },
    })
    first = one.json.note?.id ?? ''

    const two = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'two.md', content: 'the other words' },
    })
    second = two.json.note?.id ?? ''

    // Both notes have a version from a while ago, and both have moved on since.
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${first}`, {
      method: 'PUT',
      token,
      body: { content: 'changed since', baseVersion: 1 },
    })
    await call(env, `/v1/notes/${second}`, {
      method: 'PUT',
      token,
      body: { content: 'changed as well', baseVersion: 1 },
    })
  })

  afterEach(() => env.close())

  /** Between the two versions each note has: the older one is what a rollback
   *  puts back, and the newer one is the change being undone. */
  const before = () => Date.now() - 60 * 1000

  test('says what would change before it changes anything', async () => {
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before(), dry: true },
    })

    expect(asked.status).toBe(200)
    expect(asked.json.notes).toBe(2)
    expect(asked.json.paths).toEqual(['Plans/one.md', 'two.md'])

    const still = await call<VersionView>(env, `/v1/notes/${first}`, { token })
    expect(still.json.content).toBe('changed since')
  })

  test('then writes the words back as a new version of each note', async () => {
    const done = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before() },
    })

    expect(done.json.notes).toBe(2)

    const one = await call<VersionView>(env, `/v1/notes/${first}`, { token })
    expect(one.json.content).toBe('the first words')
    expect(one.json.note?.version).toBe(3)

    const two = await call<VersionView>(env, `/v1/notes/${second}`, { token })
    expect(two.json.content).toBe('the other words')
  })

  test('and the version it writes says which device asked', async () => {
    // Far enough back that the five minute rule lets a version be kept at all:
    // a rollback is a write like any other and is kept like any other.
    agedBy(env, 6 * 60 * 1000)

    const done = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: Date.now() - 9 * 60 * 1000 },
      headers: { 'x-nib-device': 'the laptop' },
    })

    expect(done.json.notes).toBe(2)
    expect(rows(env, first).at(-1)?.by).toBe('the laptop')
  })

  test('or only one folder of it', async () => {
    const done = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before(), under: 'Plans' },
    })

    expect(done.json.notes).toBe(1)

    const outside = await call<VersionView>(env, `/v1/notes/${second}`, { token })
    expect(outside.json.content).toBe('changed as well')
  })

  test('refuses a moment nobody named', async () => {
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, { token, body: {} })

    expect(asked.status).toBe(400)
    expect(asked.json.error).toBe('when to go back to')
  })

  test('and somebody who may only read the space', async () => {
    const other = await signIn(env, 'c@d.dev')
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token: other,
      body: { at: Date.now() },
    })

    expect(asked.status).toBe(404)
  })
})

describe('the sweep', () => {
  let env: TestEnv
  let token: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const space = made.json.space?.id ?? ''
    const wrote = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: 'first' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('takes a version older than the month, and its body with it', async () => {
    agedBy(env, KEEP_FOR + 1000)

    const held = rows(env, note)[0]?.hash ?? ''
    expect(env.keys()).toContain(versionKey(held))

    await sweepVersions(env, Date.now())

    expect(rows(env, note)).toHaveLength(0)
    expect(env.keys()).not.toContain(versionKey(held))
  })

  test('keeps a version inside the month', async () => {
    await sweepVersions(env, Date.now())

    expect(rows(env, note)).toHaveLength(1)
  })

  test('leaves a body another note still says', async () => {
    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Other' } })
    await call(env, `/v1/spaces/${made.json.space?.id ?? ''}/notes`, {
      token,
      body: { path: 'same.md', content: 'first' },
    })

    const held = rows(env, note)[0]?.hash ?? ''
    env.db.exec(`delete from note_versions where note_id = '${note}'`)
    await sweepVersions(env, Date.now())

    expect(env.keys()).toContain(versionKey(held))
  })
})

describe('thinning to one an hour', () => {
  test('keeps the newest in each hour and names the rest', () => {
    const hour = 60 * 60 * 1000
    const crowded = tooClose([
      { note_id: 'a', at: 5 * hour + 600, hash: 'one' },
      { note_id: 'a', at: 5 * hour + 300, hash: 'two' },
      { note_id: 'a', at: 4 * hour + 100, hash: 'three' },
      { note_id: 'b', at: 5 * hour + 500, hash: 'four' },
    ])

    expect(crowded.map((one) => one.hash)).toEqual(['two'])
  })

  test('and nothing where every version is an hour apart', () => {
    const hour = 60 * 60 * 1000
    const rows = [1, 2, 3].map((at) => ({ note_id: 'a', at: at * hour, hash: String(at) }))

    expect(tooClose(rows)).toEqual([])
  })
})
