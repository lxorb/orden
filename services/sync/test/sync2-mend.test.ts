import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FeedPage, OpsResponse } from '@orden/sync-core'
import { sha256 } from '../src/crypto'
import { noteKey } from '../src/notes'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { live } from './sync2'

let settled: () => Promise<void> = () => Promise.resolve()

let env: TestEnv
let token: string
let space: string
let user: string

beforeEach(async () => {
  env = testEnv()
  const rooms = live(env)
  settled = () => rooms.settle()
  token = await signIn(env, 'mend@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Mend' } })).json.space.id
  user = (env.db.prepare('select id from users').get() as { id: string }).id
})

afterEach(() => env.close())

interface Live {
  id: string
  name: string
  parent: string | null
  meta: string | null
}

function liveNotes(): Live[] {
  return env.db
    .prepare(
      `select id, name, folder_id as parent, meta from notes
        where space_id = ? and deleted = 0 order by name, id`,
    )
    .all(space) as unknown as Live[]
}

function liveFolders(): Live[] {
  return env.db
    .prepare(
      `select id, name, parent_id as parent, meta from folders
        where space_id = ? and deleted = 0 order by name, id`,
    )
    .all(space) as unknown as Live[]
}

async function made(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  if (answer.status !== 201) throw new Error(`${path}: ${answer.text}`)
  return answer.json.note.id
}

async function prepare(): Promise<void> {
  const answer = await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
  expect(answer.status).toBe(200)
}

let counter = 0
function op(t: string, fields: Record<string, unknown>) {
  counter += 1
  return { op: `op-${String(counter)}`, t, seen: 0, ...fields }
}

async function ops(list: readonly object[]): Promise<OpsResponse> {
  const answer = await call<OpsResponse>(env, `/v2/spaces/${space}/ops`, {
    token,
    body: { ops: list },
  })
  expect(answer.status, answer.text).toBe(200)
  return answer.json
}

async function feed(): Promise<FeedPage> {
  const answer = await call<FeedPage>(env, `/v2/spaces/${space}/feed?since=0`, { token })
  expect(answer.status).toBe(200)
  return answer.json
}

async function written(id: string, text: string): Promise<void> {
  await env.NOTES.put(noteKey(space, id), text)
  env.db
    .prepare('update notes set hash = ?, size = ? where id = ?')
    .run(await sha256(text), text.length, id)
}

function fresh(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

function versionHashes(id: string): string[] {
  return (
    env.db.prepare('select hash from note_versions where note_id = ?').all(id) as { hash: string }[]
  ).map((one) => one.hash)
}

function protectedPaths(): string[] {
  const row = env.db.prepare('select protected from users where id = ?').get(user) as {
    protected: string | null
  }
  const held = JSON.parse(row.protected ?? '{}') as {
    spaces?: Record<string, Record<string, string>>
  }
  return Object.keys(held.spaces?.[space] ?? {}).sort()
}

describe('a device that sent every item back as new', () => {
  test('has each copy merged back into its item, which keeps its id, icon and protection, and the copy’s words kept as a version', async () => {
    const plan = await made('Plan.md', 'plan now\n')
    const b = await made('Work/b.md', 'b\n')
    await prepare()
    const work = liveFolders()[0]?.id ?? ''
    await ops([op('meta', { id: plan, meta: { icon: 'star' } })])
    env.db
      .prepare('update users set protected = ? where id = ?')
      .run(
        JSON.stringify({ password: null, spaces: { [space]: { 'Plan 2.md': 'password' } } }),
        user,
      )

    const [folderCopy, planCopy, bCopy, extra] = [fresh(), fresh(), fresh(), fresh()]
    const { results } = await ops([
      op('mkdir', { id: folderCopy, parent: null, name: 'Work' }),
      op('create', { id: planCopy, kind: 'note', parent: null, name: 'Plan.md' }),
      op('create', { id: bCopy, kind: 'note', parent: folderCopy, name: 'b.md' }),
      op('create', { id: extra, kind: 'note', parent: folderCopy, name: 'extra.md' }),
    ])
    expect(results.map((one) => ('name' in one ? one.name : null))).toEqual([
      'Work 2',
      'Plan 2.md',
      'b.md',
      'extra.md',
    ])
    await written(planCopy, 'plan as it was\n')
    await written(bCopy, 'b\n')
    env.db
      .prepare('update notes set hash = (select hash from notes where id = ?) where id = ?')
      .run(b, bCopy)

    const page = await feed()

    expect(liveFolders().map((one) => [one.id, one.name])).toEqual([[work, 'Work']])
    expect(liveNotes().map((one) => [one.id, one.name, one.parent])).toEqual([
      [plan, 'Plan.md', null],
      [b, 'b.md', work],
      [extra, 'extra.md', work],
    ])
    expect(liveNotes()[0]?.meta).toContain('star')
    expect(versionHashes(plan)).toContain(await sha256('plan as it was\n'))
    expect(protectedPaths()).toEqual(['Plan 2.md', 'Plan.md'])
    const gone = page.items.filter((item) => item.deleted).map((item) => item.id)
    expect(gone).toEqual(expect.arrayContaining([folderCopy, planCopy, bCopy]))
    expect(env.keys().some((key) => key.startsWith(`mended/${space}/`))).toBe(true)
  })

  test('is mended once, and mending again changes nothing', async () => {
    const plan = await made('Plan.md', 'plan\n')
    const idea = await made('Idea.md', 'idea\n')
    await prepare()
    const [planCopy, ideaCopy] = [fresh(), fresh()]
    await ops([
      op('create', { id: planCopy, kind: 'note', parent: null, name: 'Plan.md' }),
      op('create', { id: ideaCopy, kind: 'note', parent: null, name: 'Idea.md' }),
    ])
    await written(planCopy, 'plan\n')
    await written(ideaCopy, 'idea\n')

    await feed()
    const after = liveNotes()
    const versions = [versionHashes(plan), versionHashes(idea)]
    env.db.prepare('update spaces set mended_at = null where id = ?').run(space)
    await feed()

    expect(after.map((one) => one.id)).toEqual([idea, plan])
    expect(liveNotes()).toEqual(after)
    expect([versionHashes(plan), versionHashes(idea)]).toEqual(versions)
  })

  test('takes the words of a copy written after it was made, and keeps the item’s own as a version', async () => {
    const plan = await made('Plan.md', 'plan before\n')
    const idea = await made('Idea.md', 'idea\n')
    await prepare()
    const [planCopy, ideaCopy] = [fresh(), fresh()]
    await ops([
      op('create', { id: planCopy, kind: 'note', parent: null, name: 'Plan.md' }),
      op('create', { id: ideaCopy, kind: 'note', parent: null, name: 'Idea.md' }),
    ])
    await written(planCopy, 'plan written later\n')
    await written(ideaCopy, 'idea\n')
    env.db
      .prepare('update notes set updated_at = ? where id = ?')
      .run(Date.now() + 10 * 60_000, planCopy)

    await feed()

    expect(liveNotes().map((one) => one.id)).toEqual([idea, plan])
    expect(versionHashes(plan)).toContain(await sha256('plan before\n'))
    await settled()
    const read = await call<{ content: string }>(env, `/v1/notes/${plan}`, { token })
    expect(read.json.content).toBe('plan written later\n')
  })

  test('leaves alone a single copy a person made of one note', async () => {
    const plan = await made('Plan.md', 'plan\n')
    await prepare()
    const copy = fresh()
    await ops([op('create', { id: copy, kind: 'note', parent: null, name: 'Plan.md' })])

    await feed()

    expect(liveNotes().map((one) => [one.id, one.name])).toEqual([
      [copy, 'Plan 2.md'],
      [plan, 'Plan.md'],
    ])
  })
})
