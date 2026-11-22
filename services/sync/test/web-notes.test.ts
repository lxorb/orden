import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FeedPage, OpsResponse, PullResponse } from '@orden/sync-core'
import { WEB_NOTE_UNSHARED } from '../src/sync-server/src/api'
import { call, joined, mail, signIn, type TestEnv, testEnv } from './harness'
import { framed, live } from './sync2'

const SITE = '[InternetShortcut]\nURL=https://example.com/\n'
let env: TestEnv
let owner: string
let space: string
beforeEach(async () => {
  env = testEnv()
  live(env)
  owner = await signIn(env, 'a@example.com')
  space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Shared' } })).json.space.id
})
afterEach(() => env.close())
async function made(path: string, content: string, token = owner): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  if (answer.status !== 201) throw new Error(`${path}: ${answer.text}`)
  return answer.json.note.id
}
async function feed(token: string): Promise<FeedPage & { items: (FeedPage['items'][number] & { own?: true })[] }> {
  const answer = await call<FeedPage>(env, `/v2/spaces/${space}/feed?since=0`, { token })
  expect(answer.status, answer.text).toBe(200)
  return answer.json
}
let counter = 0
async function created(name: string, token: string): Promise<string> {
  counter += 1
  const id = `${String(counter).padStart(2, '0')}${'ab'.repeat(15)}`
  const answer = await call<OpsResponse>(env, `/v2/spaces/${space}/ops`, {
    token,
    body: { ops: [{ op: `op-${String(counter)}`, t: 'create', kind: 'url', parent: null, name, id, seen: 0 }] },
  })
  expect(answer.status, answer.text).toBe(200)
  expect(answer.json.results[0]).toMatchObject({ id })
  return id
}
describe('a web note is never shared', () => {
  test('a share link, an invite or an admission for it is refused, and nothing is made', async () => {
    const web = await made('Notes/Docs.url', SITE)
    const link = await call(env, `/v1/spaces/${space}/share/link?item=${web}`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    expect(link.status).toBe(400)
    expect(link.json).toEqual({ error: WEB_NOTE_UNSHARED })
    let invite: Awaited<ReturnType<typeof call>> | null = null
    const sent = await mail(async () => {
      invite = await call(env, `/v1/spaces/${space}/share/invite?item=${web}`, {
        token: owner,
        body: { email: 'b@example.com', role: 'read' },
      })
    })
    expect(invite).toMatchObject({ status: 400, json: { error: WEB_NOTE_UNSHARED } })
    expect(sent).not.toContain('/join/')
    expect(env.db.prepare('select count(*) as n from space_links').get()).toEqual({ n: 0 })
    expect(env.db.prepare("select count(*) as n from space_members where item <> ''").get()).toEqual({ n: 0 })
    const note = await made('Notes/Docs.md', '# Docs\n')
    const shared = await call(env, `/v1/spaces/${space}/share/link?item=${note}`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    expect(shared.status).toBe(200)
  })
  test('a link made for one before leads nowhere, and it is not shared with anyone', async () => {
    const web = await made('Docs.URL', SITE)
    env.db
      .prepare(
        "insert into space_links (space_id, item, token, role, mode, created_at) values (?, ?, 'old', 'read', 'open', 1)",
      )
      .run(space, web)
    const member = await signIn(env, 'b@example.com')
    expect((await call(env, '/v1/join/old', { token: member })).status).toBe(404)
  })
  test('a published blog leaves every web note out', async () => {
    await made('Hello.md', '# Hello\n\nWorld.\n')
    await made('Notes/Docs.url', SITE)
    expect(
      (await call(env, `/v1/spaces/${space}/blog`, { method: 'PUT', token: owner, body: { subdomain: 'field' } }))
        .status,
    ).toBe(200)
    for (const path of ['/', '/feed.xml', '/sitemap.xml']) {
      const page = await call(env, path, { host: 'field.orden.so' })
      expect(page.text).toMatch(/hello/i)
      expect(page.text).not.toMatch(/docs|example\.com/i)
    }
    for (const path of ['/notes/docs', '/notes/docs.url', '/Notes/Docs.url']) {
      expect((await call(env, path, { host: 'field.orden.so' })).status).toBe(404)
    }
    const only = await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token: owner,
      body: { note: 'Notes/Docs.url' },
    })
    expect(only).toMatchObject({ status: 400, json: { error: WEB_NOTE_UNSHARED } })
  })
})
describe('in a shared space, a web note stays with whoever made it', () => {
  test('another member never receives it, while the maker’s other device does', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'write')
    const second = await signIn(env, 'a@example.com')
    const web = await created('Docs.url', owner)
    const page = await made('Plain.md', '# Plain\n')
    const theirs = await feed(member)
    expect(theirs.items.find((item) => item.id === web)).toEqual({
      id: web,
      kind: 'url',
      parent: null,
      name: web,
      deleted: true,
      seq: expect.any(Number) as number,
      hash: '',
      size: 0,
      by: '',
      at: expect.any(Number) as number,
    })
    expect(theirs.items.find((item) => item.id === page)).toMatchObject({ deleted: false })
    expect(JSON.stringify(theirs)).not.toContain('Docs.url')
    const mine = await feed(second)
    expect(mine).toMatchObject({ owns: true })
    expect(mine.items.find((item) => item.id === web)).toMatchObject({ name: 'Docs.url', deleted: false, own: true })
    expect(mine.items.find((item) => item.id === page)).not.toHaveProperty('own')
    const asked = { docs: [{ id: web, epoch: 1, sv: new Uint8Array([0]) }] }
    expect((await framed<PullResponse>(env, '/v2/docs/pull', member, asked)).value.docs[0]).toMatchObject({
      refused: 'gone',
    })
    expect((await framed<PullResponse>(env, '/v2/docs/pull', second, asked)).value.docs[0]).not.toHaveProperty(
      'refused',
    )
  })
  test('a member’s own web note stays theirs, and the owner does not receive it either', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'write')
    const web = await made('Bank.url', SITE, member)
    expect((await call(env, `/v1/notes/${web}`, { token: member })).status).toBe(200)
    expect((await call(env, `/v1/notes/${web}`, { token: owner })).status).toBe(404)
    const changes = await call<{ notes: { id: string; path: string; deleted: boolean }[] }>(
      env,
      `/v1/spaces/${space}/changes?since=0`,
      { token: owner },
    )
    expect(changes.json.notes.find((note) => note.id === web)).toMatchObject({ deleted: true })
    const theirs = await call<{ notes: { id: string; deleted: boolean }[] }>(
      env,
      `/v1/spaces/${space}/changes?since=0`,
      { token: member },
    )
    expect(theirs.json.notes.find((note) => note.id === web)).toMatchObject({ deleted: false })
    expect((await feed(owner)).items.find((item) => item.id === web)).toMatchObject({ deleted: true })
  })
  test('a web note from before, with no maker kept, belongs to the space’s owner', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'write')
    const web = await made('Old.url', SITE, member)
    env.db.prepare('update notes set made_by = null, updated_by = null where id = ?').run(web)
    expect((await call(env, `/v1/notes/${web}`, { token: member })).status).toBe(404)
    expect((await call(env, `/v1/notes/${web}`, { token: owner })).status).toBe(200)
  })
})
