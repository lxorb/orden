import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { OpsResponse } from '@orden/sync-core'
import { saveNote } from '../src/sync-server-engine/src/notes'
import { purgeExpired } from '../src/sync-server-engine/src/trash'
import { GRACE } from '../src/sync-server-engine/src/unused'
import type { Note } from '../src/sync-server/src/types'
import { sweepVersions } from '../src/sync-server/src/versions'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { live } from './sync2'

const DAY = 24 * 60 * 60 * 1000
let env: TestEnv
let token: string
let space: string
let assets: string
let counter = 0
beforeEach(async () => {
  env = testEnv()
  live(env)
  token = await signIn(env, 'owner@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Papers' } })).json.space.id
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
  assets = await made({ t: 'mkdir', parent: null, name: 'assets' })
})
afterEach(() => env.close())
async function made(op: Record<string, unknown>): Promise<string> {
  counter += 1
  const id = `entry-${String(counter)}`
  const answer = await call<OpsResponse>(env, `/v2/spaces/${space}/ops`, {
    token,
    body: { ops: [{ op: `op-${id}`, id, seen: 0, ...op }] },
  })
  expect(answer.json.results[0], answer.text).toMatchObject({ id })
  return id
}
async function attached(
  seed: string,
  name?: (hash: string) => string,
): Promise<{ hash: string; id: string; name: string }> {
  const bytes = new TextEncoder().encode(`%PDF ${seed}`)
  const hash = createHash('sha256').update(bytes).digest('hex')
  await call(env, `/v2/blobs/${hash}`, {
    method: 'PUT',
    token,
    raw: bytes,
    headers: { 'content-type': 'application/pdf' },
  })
  const named = name ? name(hash) : `${hash.slice(0, 16)}.pdf`
  const id = await made({ t: 'create', kind: 'file', parent: assets, name: named, hash })
  return { hash, id, name: named }
}
async function note(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  expect(answer.status, answer.text).toBe(201)
  return answer.json.note.id
}
async function rewritten(id: string, content: string): Promise<void> {
  const held = env.db.prepare('select * from notes where id = ?').get(id) as Note
  expect(await saveNote(env, held, content, held.path)).not.toBeNull()
}
const shown = (id: string) =>
  (env.db.prepare('select hash from note_pictures where note_id = ?').all(id) as { hash: string }[]).map(
    (one) => one.hash,
  )
const entry = (id: string) =>
  env.db.prepare('select deleted, deleted_at from notes where id = ?').get(id) as {
    deleted: number
    deleted_at: number | null
  }
const holds = (hash: string) =>
  (env.db.prepare('select count(*) as n from blobs where hash = ?').get(hash) as { n: number }).n
const versionsGone = () => sweepVersions(env, Date.now() + 2 * GRACE)
describe('a file stored by its hash', () => {
  test('is counted for every note, canvas and old client that links or embeds it', async () => {
    const file = await attached('one')
    const linked = await note('Linked.md', `See [Report.pdf](assets/${file.name}).\n`)
    const embedded = await note('Embedded.md', `![[assets/${file.name}]]\n`)
    const canvas = await note(
      'Board.canvas',
      JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: `assets/${file.name}`, x: 0, y: 0 }], edges: [] }),
    )
    const elsewhere = await note('Plain.md', 'nothing here\n')
    for (const id of [linked, embedded, canvas]) expect(shown(id)).toEqual([file.hash])
    expect(shown(elsewhere)).toEqual([])
  })
  test('goes to Recently deleted a grace after its last link went, and its bytes only after that', async () => {
    const file = await attached('dropped')
    const id = await note('A.md', `[Report.pdf](assets/${file.name})\n`)
    await rewritten(id, 'no file now\n')
    await versionsGone()
    await purgeExpired(env, Date.now() + GRACE - DAY)
    expect(entry(file.id)).toEqual({ deleted: 0, deleted_at: null })
    await purgeExpired(env, Date.now() + GRACE)
    expect(entry(file.id)).toMatchObject({ deleted: 1, deleted_at: expect.any(Number) as number })
    expect(holds(file.hash)).toBe(1)
    await purgeExpired(env, Date.now() + 15 * DAY)
    expect(holds(file.hash)).toBe(1)
    await purgeExpired(env, Date.now() + 15 * DAY + GRACE)
    expect(holds(file.hash)).toBe(0)
  })
  test('stays while another note links it', async () => {
    const file = await attached('twice')
    const id = await note('A.md', `[Report.pdf](assets/${file.name})\n`)
    await note('B.md', `[Same.pdf](assets/${file.name})\n`)
    await rewritten(id, 'gone here\n')
    await versionsGone()
    await purgeExpired(env, Date.now() + GRACE)
    expect(entry(file.id)).toEqual({ deleted: 0, deleted_at: null })
  })
  test('stays while a saved version links it', async () => {
    const file = await attached('versioned')
    const id = await note('A.md', `[Report.pdf](assets/${file.name})\n`)
    await rewritten(id, 'gone from the note\n')
    await purgeExpired(env, Date.now() + GRACE)
    expect(entry(file.id)).toEqual({ deleted: 0, deleted_at: null })
  })
  test('comes back from Recently deleted when a note links it again', async () => {
    const file = await attached('back')
    const id = await note('A.md', `[Report.pdf](assets/${file.name})\n`)
    await rewritten(id, 'gone for a while\n')
    await versionsGone()
    await purgeExpired(env, Date.now() + GRACE)
    expect(entry(file.id).deleted).toBe(1)
    await rewritten(id, `back [Report.pdf](assets/${file.name})\n`)
    expect(entry(file.id)).toEqual({ deleted: 0, deleted_at: null })
    expect(shown(id)).toEqual([file.hash])
  })
  test('a file under its own name is never moved, whatever links it', async () => {
    const file = await attached('named', () => 'Report.pdf')
    const id = await note('A.md', '[Report.pdf](assets/Report.pdf)\n')
    await rewritten(id, 'no link now\n')
    await versionsGone()
    await purgeExpired(env, Date.now() + 2 * GRACE)
    expect(entry(file.id)).toEqual({ deleted: 0, deleted_at: null })
    expect(holds(file.hash)).toBe(1)
  })
})
