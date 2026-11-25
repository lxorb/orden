import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { OpsResponse } from '@orden/sync-core'
import { call, signIn, type ShareView, type TestEnv, testEnv } from './harness'
import { live } from './sync2'

let env: TestEnv
let owner: string
beforeEach(async () => {
  env = testEnv()
  live(env)
  owner = await signIn(env, 'owner@example.com')
})
afterEach(() => env.close())
async function made(name: string): Promise<string> {
  const space = (await call(env, '/v1/spaces', { token: owner, body: { name } })).json.space.id
  await call(env, `/v2/spaces/${space}/prepare`, { token: owner, method: 'POST' })
  return space
}
async function guestOf(space: string, role: 'write' | 'read'): Promise<string> {
  const link = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
    method: 'PUT',
    token: owner,
    body: { role, mode: 'open' },
  })
  const found = /\/join\/([a-f0-9]+)/.exec(link.json.link?.url ?? '')?.[1] ?? ''
  return (await call(env, `/v1/join/${found}`, { method: 'POST', body: {} })).json.token
}
async function hashOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function bytes(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, at) => (at * 31 + seed) % 251)
}
async function upload(data: Uint8Array, token: string, space?: string) {
  return call(env, `/v2/blobs/${await hashOf(data)}${space ? `?space=${space}` : ''}`, {
    method: 'PUT',
    token,
    raw: data,
    headers: { 'content-type': 'application/pdf' },
  })
}
let counter = 0
async function place(space: string, hash: string, token: string) {
  counter += 1
  const id = `file-${String(counter)}`
  const answer = await call<OpsResponse>(env, `/v2/spaces/${space}/ops`, {
    token,
    body: { ops: [{ op: `op-${id}`, t: 'create', id, kind: 'file', parent: null, name: `${id}.pdf`, hash, seen: 0 }] },
  })
  expect(answer.status, answer.text).toBe(200)
  return { id, result: answer.json.results[0] }
}
const rows = () => env.db.prepare('select hash, user_id from blobs').all() as { hash: string; user_id: string }[]
describe('a guest adds a file to a space', () => {
  test('one who may write uploads the bytes, under the owner, and places them in that space', async () => {
    const space = await made('Shared')
    const guest = await guestOf(space, 'write')
    const data = bytes(4096)
    const hash = await hashOf(data)
    const owned = (env.db.prepare('select user_id from spaces where id = ?').get(space) as { user_id: string }).user_id
    const answer = await upload(data, guest, space)
    expect(answer.status, answer.text).toBe(201)
    expect(rows()).toEqual([{ hash, user_id: owned }])
    expect((await call(env, '/v2/blobs/have', { token: guest, body: { hashes: [hash], space } })).json).toEqual({
      kept: [hash],
    })
    const { id, result } = await place(space, hash, guest)
    expect(result).toMatchObject({ id })
    const read = await call(env, `/v2/files/${space}/${id}`, { token: guest })
    expect(read.status).toBe(200)
    expect(read.text.length).toBe(4096)
  })
  test('one who may only read is refused, and nothing is kept', async () => {
    const space = await made('Shared')
    const guest = await guestOf(space, 'read')
    const answer = await upload(bytes(4096), guest, space)
    expect(answer.status).toBe(403)
    expect(rows()).toEqual([])
    expect(env.keys().some((key) => key.startsWith('blobs/'))).toBe(false)
  })
  test('another space is refused, and so is an upload that names no space', async () => {
    const space = await made('Shared')
    const other = await made('Private')
    const guest = await guestOf(space, 'write')
    expect((await upload(bytes(4096), guest, other)).status).toBe(404)
    expect((await upload(bytes(4096), guest)).status).toBe(400)
    expect((await call(env, '/v2/blobs/have', { token: guest, body: { hashes: ['a'.repeat(64)] } })).status).toBe(400)
    expect(rows()).toEqual([])
  })
  test('the owner’s files elsewhere stay out of reach, even by their hash', async () => {
    const space = await made('Shared')
    const other = await made('Private')
    const guest = await guestOf(space, 'write')
    const secret = bytes(2048, 7)
    const hash = await hashOf(secret)
    expect((await upload(secret, owner, other)).status).toBe(201)
    await place(other, hash, owner)
    expect((await call(env, '/v2/blobs/have', { token: guest, body: { hashes: [hash], space } })).json).toEqual({
      kept: [],
    })
    expect((await place(space, hash, guest)).result).not.toHaveProperty('id')
    expect(
      (await call(env, `/v2/blobs/${hash}?space=${space}`, { method: 'PUT', token: guest, raw: bytes(2048, 8) }))
        .status,
    ).toBe(400)
    expect((await place(space, hash, guest)).result).not.toHaveProperty('id')
  })
})
