import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { call, signIn, type TestEnv, testEnv } from './harness'
import { programMayReach } from '../src/sync-server/src/programs'

interface ProgramView {
  token?: string
  spaces?: { id: string; name: string }[]
  notes?: { id: string; path: string; version: number }[]
  note?: { id: string; version: number }
  content?: string
  cursor?: number
  error?: string
  space?: { id: string }
}

describe('what a program may reach', () => {
  test('is the sync surface and nothing else', () => {
    expect(programMayReach('GET', '/v1/spaces', false)).toBe(true)
    expect(programMayReach('GET', '/v1/spaces/abc/changes', false)).toBe(true)
    expect(programMayReach('GET', '/v1/notes/abc', false)).toBe(true)
    expect(programMayReach('PUT', '/v1/notes/abc', false)).toBe(true)
    expect(programMayReach('POST', '/v1/spaces/abc/notes', false)).toBe(true)
    expect(programMayReach('GET', '/v1/notes/abc/versions', false)).toBe(true)
  })

  test('and not the account, the sharing, the trash or a delete', () => {
    expect(programMayReach('GET', '/v1/me', false)).toBe(false)
    expect(programMayReach('PATCH', '/v1/settings', false)).toBe(false)
    expect(programMayReach('GET', '/v1/trash', false)).toBe(false)
    expect(programMayReach('POST', '/v1/spaces', false)).toBe(false)
    expect(programMayReach('DELETE', '/v1/notes/abc', false)).toBe(false)
    expect(programMayReach('PUT', '/v1/spaces/abc/blog', false)).toBe(false)
  })

  test('and nothing about the second factor or the sessions', () => {
    for (const path of ['/v1/second', '/v1/second/confirm', '/v1/second/recovery']) {
      expect(programMayReach('GET', path, false)).toBe(false)
      expect(programMayReach('POST', path, false)).toBe(false)
      expect(programMayReach('DELETE', path, false)).toBe(false)
    }

    expect(programMayReach('GET', '/v1/sessions', false)).toBe(false)
    expect(programMayReach('DELETE', '/v1/sessions', false)).toBe(false)
    expect(programMayReach('DELETE', '/v1/sessions/abc', false)).toBe(false)
  })

  test('and a rollback, which writes versions rather than taking anything away', () => {
    expect(programMayReach('POST', '/v1/spaces/abc/rollback', false)).toBe(true)
    expect(programMayReach('POST', '/v1/spaces/abc/rollback', true)).toBe(false)
    expect(programMayReach('POST', '/v1/spaces/abc/rollback/all', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/abc/rollback', false)).toBe(false)
  })

  test('and nothing of the hub: its socket, or the devices', () => {
    for (const [method, path] of [
      ['GET', '/v2/hub'],
      ['GET', '/v2/devices'],
    ] as const) {
      expect(programMayReach(method, path, false), `${method} ${path}`).toBe(false)
    }
  })

  test('and no path that only looks like one on the list', () => {
    expect(programMayReach('GET', '/v1/notes/abc/', false)).toBe(false)
    expect(programMayReach('GET', '/v1/notes/abc/versions/1/more', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/abc/changes/x', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/abc/notes', false)).toBe(false)
    expect(programMayReach('GET', '/v1/spaces/available/changes', false)).toBe(false)
  })

  test('and a token that may only read reaches nothing that writes', () => {
    expect(programMayReach('GET', '/v1/notes/abc', true)).toBe(true)
    expect(programMayReach('PUT', '/v1/notes/abc', true)).toBe(false)
    expect(programMayReach('POST', '/v1/spaces/abc/notes', true)).toBe(false)
  })

  test('and of sync v2, the feed and the pull and nothing that writes', () => {
    for (const readOnly of [false, true]) {
      expect(programMayReach('GET', '/v2/spaces/abc/feed', readOnly)).toBe(true)
      expect(programMayReach('POST', '/v2/docs/pull', readOnly)).toBe(true)
    }
    for (const [method, path] of [
      ['POST', '/v2/spaces/abc/ops'],
      ['POST', '/v2/spaces/abc/prepare'],
      ['POST', '/v2/docs/push'],
      ['POST', '/v2/docs/keep'],
      ['GET', '/v2/files/abc/def'],
      ['PUT', '/v2/files/abc/def'],
      ['PUT', `/v2/blobs/${'a'.repeat(64)}`],
    ] as const) {
      expect(programMayReach(method, path, false), `${method} ${path}`).toBe(false)
    }
  })
})

describe('a token acting for somebody', () => {
  let env: TestEnv
  let token: string
  let program: string
  let space: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const minted = await call<ProgramView>(env, '/v1/mcp/token', {
      token,
      body: { readOnly: false },
    })
    program = minted.json.token ?? ''

    const made = await call<ProgramView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''

    const wrote = await call<ProgramView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: '# One' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('lists the spaces it may write in', async () => {
    const listed = await call<ProgramView>(env, '/v1/spaces', { token: program })

    expect(listed.status).toBe(200)
    expect(listed.json.spaces?.some((one) => one.name === 'Work')).toBe(true)
  })

  test('reads the change feed and a note out of it', async () => {
    const changes = await call<ProgramView>(env, `/v1/spaces/${space}/changes?since=0`, {
      token: program,
    })

    expect(changes.status).toBe(200)
    const listed = changes.json.notes?.find((one) => one.path === 'plan.md')
    expect(listed).toBeDefined()

    const said = await call<ProgramView>(env, `/v1/notes/${listed?.id ?? ''}`, { token: program })
    expect(said.json.content).toBe('# One')
  })

  test('writes a note back', async () => {
    const put = await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: program,
      body: { content: '# Two', baseVersion: 1 },
    })

    expect(put.status).toBe(200)

    const said = await call<ProgramView>(env, `/v1/notes/${note}`, { token })
    expect(said.json.content).toBe('# Two')
  })

  test('and puts a space back to how it read at a moment', async () => {
    const before = Date.now()

    await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: program,
      body: { content: '# Wrong', baseVersion: 1 },
    })

    const dry = await call<{ notes: number; paths: string[] }>(env, `/v1/spaces/${space}/rollback`, {
      token: program,
      body: { at: before, dry: true },
    })

    expect(dry.status).toBe(200)
    expect(dry.json.notes).toBe(1)
    expect(dry.json.paths).toEqual(['plan.md'])

    const put = await call<{ notes: number; partial: boolean }>(env, `/v1/spaces/${space}/rollback`, {
      token: program,
      body: { at: before },
    })

    expect(put.status).toBe(200)
    expect(put.json.notes).toBe(1)

    const said = await call<ProgramView>(env, `/v1/notes/${note}`, { token })
    expect(said.json.content).toBe('# One')
  })

  test('and a read-only token cannot, because a rollback writes', async () => {
    const minted = await call<ProgramView>(env, '/v1/mcp/token', { token, body: {} })
    const refused = await call<ProgramView>(env, `/v1/spaces/${space}/rollback`, {
      token: minted.json.token ?? '',
      body: { at: Date.now(), dry: true },
    })

    expect(refused.status).toBe(403)
  })

  test('and is refused everything else, in as many words', async () => {
    const me = await call<ProgramView>(env, '/v1/me', { token: program })
    expect(me.status).toBe(403)
    expect(me.json.error).toBe('that is not something a token can do')

    const spelled = await call<ProgramView>(env, '/v1/spaces/%61vailable/changes', {
      token: program,
    })
    expect(spelled.status).toBe(403)

    const gone = await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'DELETE',
      token: program,
    })
    expect(gone.status).toBe(403)

    const still = await call<ProgramView>(env, `/v1/notes/${note}`, { token })
    expect(still.status).toBe(200)
  })

  test('a read-only token reads and does not write', async () => {
    const minted = await call<ProgramView>(env, '/v1/mcp/token', { token, body: {} })
    const reader = minted.json.token ?? ''

    const said = await call<ProgramView>(env, `/v1/notes/${note}`, { token: reader })
    expect(said.status).toBe(200)

    const put = await call<ProgramView>(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: reader,
      body: { content: '# Three', baseVersion: 1 },
    })
    expect(put.status).toBe(403)
  })

  test('is turned away from the devices and the web state', async () => {
    const key = 'k'.repeat(43)
    for (const [method, path] of [
      ['GET', '/v2/devices'],
      ['GET', `/v2/web/${key}`],
      ['PUT', `/v2/web/${key}`],
      ['PUT', `/v2/web/chunks/${key}`],
    ] as const) {
      const answer = await call<ProgramView>(env, path, {
        method,
        token: program,
        ...(method === 'PUT' ? { raw: new Uint8Array([1]) } : {}),
      })
      expect(answer.status, `${method} ${path}`).toBe(403)
    }
  })

  test('and a token nobody minted is nobody', async () => {
    const said = await call<ProgramView>(env, '/v1/spaces', { token: 'nib_nonsense' })

    expect(said.status).toBe(401)
    expect(said.json.error).toBe('sign in first')
  })
})

describe('a token, in an account that keeps notes from agents', () => {
  let env: TestEnv
  let token: string
  let key: string
  let home: string
  let work: string
  let diary: string
  let plan: string

  const said = (path: string, content: string, space: string) =>
    call<ProgramView>(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  const made = async (name: string) =>
    (await call<ProgramView>(env, '/v1/spaces', { token, body: { name } })).json.space?.id ?? ''
  const noteId = async (path: string, content: string, space: string) =>
    (await said(path, content, space)).json.note?.id ?? ''

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')
    home = await made('Home')
    work = await made('Work')
    diary = await noteId('Diary/Today.md', 'the secret words', home)
    plan = await noteId('Plan.md', 'the plan', home)
    await said('Open.md', 'open words', work)
    await call(env, `/v1/protected/spaces/${home}`, {
      method: 'PUT',
      token,
      body: { protected: { Diary: 'password' } },
    })
    key = (await call<ProgramView>(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token!
  })

  afterEach(() => env.close())

  test('reads no protected note and writes nothing in that space', async () => {
    expect((await call(env, `/v1/notes/${diary}`, { token: key })).status).toBe(404)
    expect((await call(env, `/v1/notes/${diary}/versions`, { token: key })).status).toBe(404)
    expect(
      (
        await call(env, `/v1/notes/${diary}`, {
          method: 'PUT',
          token: key,
          body: { content: 'overwritten', baseVersion: 1 },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await call(env, `/v1/notes/${plan}`, {
          method: 'PUT',
          token: key,
          body: { path: 'Diary/Plan.md', content: 'the plan', baseVersion: 1 },
        })
      ).status,
    ).toBe(403)
    const changes = await call(env, `/v1/spaces/${home}/changes?since=0`, { token: key })
    expect(JSON.stringify(changes.json)).toContain('Plan.md')
    expect(JSON.stringify(changes.json)).not.toMatch(/Diary|secret/)
    expect((await call(env, `/v2/spaces/${home}/feed`, { token: key })).status).toBe(403)
    expect((await call(env, `/v2/spaces/${work}/feed`, { token: key })).status).toBe(200)
    expect((await call(env, `/v1/notes/${diary}`, { token })).json).toMatchObject({
      content: 'the secret words',
    })
  })

  test('still reads an open note and another space', async () => {
    expect((await call(env, `/v1/notes/${plan}`, { token: key })).status).toBe(200)
    expect((await call(env, `/v1/spaces/${work}/changes?since=0`, { token: key })).status).toBe(200)
  })

  test('is not let through by an id written with escapes', async () => {
    const escaped = (id: string) => id.replace(/./g, (one) => `%${one.charCodeAt(0).toString(16).padStart(2, '0')}`)

    expect((await call(env, `/v1/notes/${escaped(diary)}`, { token: key })).status).toBe(404)
    expect(
      (
        await call(env, `/v1/notes/${escaped(diary)}`, {
          method: 'PUT',
          token: key,
          body: { content: 'overwritten', baseVersion: 1 },
        })
      ).status,
    ).toBe(404)
    for (const path of [`/v1/spaces/${escaped(home)}/changes?since=0`, `/v2/spaces/${escaped(home)}/feed`]) {
      expect(JSON.stringify((await call(env, path, { token: key })).json), path).not.toMatch(/Diary|secret/)
    }
    expect((await call(env, `/v1/notes/${diary}`, { token })).json).toMatchObject({
      content: 'the secret words',
    })
  })
})
