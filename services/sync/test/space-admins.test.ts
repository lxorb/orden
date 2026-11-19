import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, invitation, joined, mail, signIn, testEnv, type ShareView, type TestEnv } from './harness'

const OWNER = 'owner@example.com'
const ADMIN = 'admin@example.com'
const WRITER = 'writer@example.com'
const READER = 'reader@example.com'
const NEWCOMER = 'new@example.com'
const ONLY = 'only the owner or an admin can do that'
let env: TestEnv
let owner: string
let admin: string
let writer: string
let reader: string
let space: string
let note: string
async function asAdmin(email: string, token?: string): Promise<string> {
  const link = await invitation(env, owner, space, email, 'write')
  await call(env, `/v1/spaces/${space}/share/members/${email}`, {
    method: 'PATCH',
    token: owner,
    body: { role: 'admin' },
  })
  const signed = token ?? (await signIn(env, email))
  await call(env, `/v1/join/${link}`, { method: 'POST', token: signed })
  return signed
}
beforeEach(async () => {
  env = testEnv()
  owner = await signIn(env, OWNER)
  space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id
  note = (
    await call(env, `/v1/spaces/${space}/notes`, { token: owner, body: { path: 'plan.md', content: '# Plan\n' } })
  ).json.note.id
  admin = await asAdmin(ADMIN)
  writer = await joined(env, owner, space, WRITER, 'write')
  reader = await joined(env, owner, space, READER, 'read')
})
afterEach(() => env.close())
const view = (token: string, item = '') =>
  call<ShareView>(env, `/v1/spaces/${space}/share${item ? `?item=${item}` : ''}`, { token })
const member = (shown: ShareView, email: string) => shown.members.find((one) => one.email === email)
const stored = (email: string) =>
  env.db
    .prepare("select role, admin from space_members where space_id = ? and email = ? and item = ''")
    .get(space, email)
const patch = (token: string, email: string, role: string) =>
  call<ShareView>(env, `/v1/spaces/${space}/share/members/${email}`, { method: 'PATCH', token, body: { role } })
const invite = (token: string, email: string, role: string, item = '') =>
  call<ShareView>(env, `/v1/spaces/${space}/share/invite${item ? `?item=${item}` : ''}`, {
    token,
    body: { email, role },
  })
describe('an admin', () => {
  test('is kept as a writer the rest of the service reads, marked admin', async () => {
    expect(stored(ADMIN)).toEqual({ role: 'write', admin: 1 })
    const shown = await view(owner)
    expect(member(shown.json, ADMIN)).toMatchObject({ role: 'write', admin: true })
    expect(member(shown.json, WRITER)).toMatchObject({ role: 'write', admin: false })
  })
  test('is told so in the space listing, and the owner and the others are not', async () => {
    const flag = async (token: string) =>
      (await call(env, '/v1/spaces', { token })).json.spaces.find((one: { id: string }) => one.id === space)?.admin
    expect(await flag(admin)).toBe(true)
    expect(await flag(writer)).toBe(false)
    expect(await flag(reader)).toBe(false)
    expect(await flag(owner)).toBe(false)
  })
  test('changes what the others may do, makes an admin and unmakes one', async () => {
    expect((await patch(admin, READER, 'write')).status).toBe(200)
    expect(stored(READER)).toEqual({ role: 'write', admin: 0 })
    expect((await patch(admin, WRITER, 'admin')).status).toBe(200)
    expect(stored(WRITER)).toEqual({ role: 'write', admin: 1 })
    expect((await patch(admin, WRITER, 'read')).status).toBe(200)
    expect(stored(WRITER)).toEqual({ role: 'read', admin: 0 })
  })
  test('takes somebody out', async () => {
    const answer = await call<ShareView>(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'DELETE',
      token: admin,
    })
    expect(answer.status).toBe(200)
    expect(member(answer.json, READER)).toBeUndefined()
    expect((await call(env, `/v1/spaces/${space}`, { token: reader })).status).toBe(404)
  })
  test('invites, as an admin too, and the invitation is from them', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token: owner, body: { name: 'Emil' } })
    await call(env, '/v1/me', { method: 'PATCH', token: admin, body: { name: 'Ada' } })
    const sent = await mail(async () => {
      expect((await invite(admin, NEWCOMER, 'admin')).status).toBe(200)
    })
    expect(stored(NEWCOMER)).toEqual({ role: 'write', admin: 1 })
    expect(sent).toContain('Ada')
    expect(sent).not.toContain('Emil')
  })
  test('sets the link, and reads it and the requests in the share view', async () => {
    const set = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: admin,
      body: { role: 'read', mode: 'approval' },
    })
    expect(set.status).toBe(200)
    expect(set.json.link).toMatchObject({ role: 'read', mode: 'approval' })
    const shown = await view(admin)
    expect(shown.json.link).toMatchObject({ role: 'read', mode: 'approval' })
    expect((await call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token: admin })).status).toBe(200)
  })
  test('renames the space and gives it an icon', async () => {
    const renamed = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token: admin,
      body: { name: 'Our plans', icon: 'Briefcase' },
    })
    expect(renamed.status).toBe(200)
    expect(renamed.json.space).toMatchObject({ name: 'Our plans', icon: 'Briefcase', admin: true })
  })
  test('neither deletes the space nor publishes it nor vouches for it', async () => {
    expect((await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token: admin })).status).toBe(403)
    const published = await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token: admin,
      body: { subdomain: 'plans' },
    })
    expect(published.status).toBe(403)
    expect((await call(env, `/v1/spaces/${space}/share/trust`, { method: 'POST', token: admin })).status).toBe(403)
  })
  test('cannot invite the owner, and the owner is never among those they may change or take out', async () => {
    const asked = await invite(admin, OWNER, 'read')
    expect(asked.status).toBe(409)
    expect((await invite(admin, ADMIN, 'read')).status).toBe(409)
    const shown = await view(admin)
    expect(shown.json.owner.email).toBe(OWNER)
    expect(member(shown.json, OWNER)).toBeUndefined()
    expect((await patch(admin, OWNER, 'read')).status).toBe(404)
    await call(env, `/v1/spaces/${space}/share/members/${OWNER}`, { method: 'DELETE', token: admin })
    const listed = (await call(env, '/v1/spaces', { token: owner })).json.spaces.find(
      (one: { id: string }) => one.id === space,
    )
    expect(listed?.role).toBe('owner')
  })
  test('is never what a note shared on its own, a guest or a link gives', async () => {
    expect((await invite(owner, NEWCOMER, 'admin', note)).status).toBe(400)
    expect((await invite(admin, NEWCOMER, 'admin', note)).status).toBe(400)
    await call(env, `/v1/spaces/${space}/share/invite?item=${note}`, {
      token: owner,
      body: { email: NEWCOMER, role: 'read' },
    })
    const onNote = await call(env, `/v1/spaces/${space}/share/members/${NEWCOMER}?item=${note}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'admin' },
    })
    expect(onNote.status).toBe(400)
    const linked = await call(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'admin', mode: 'open' },
    })
    expect(linked.status).toBe(400)
    const open = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    const token = /\/join\/([a-f0-9]+)/.exec(open.json.link?.url ?? '')?.[1] ?? ''
    const guest = (await call(env, `/v1/join/${token}`, { method: 'POST', body: { device: 'Windows' } })).json
    const guestId = (await call(env, '/v1/me', { token: guest.token })).json.guest.id
    const guestAdmin = await call(env, `/v1/spaces/${space}/share/guests/${guestId}`, {
      method: 'PATCH',
      token: admin,
      body: { role: 'admin' },
    })
    expect(guestAdmin.status).toBe(400)
  })
  test('manages a note shared on its own, as the owner does', async () => {
    expect((await invite(admin, NEWCOMER, 'read', note)).status).toBe(200)
    const shown = await view(admin, note)
    expect(shown.status).toBe(200)
    expect(shown.json.members.map((one) => one.email)).toEqual([NEWCOMER])
  })
})
describe('a writer or a reader', () => {
  const ROUTES: {
    what: string
    readerHears?: string
    go: (token: string) => Promise<{ status: number; json: { error?: string } }>
  }[] = [
    { what: 'inviting', go: (token) => invite(token, NEWCOMER, 'read') },
    { what: 'changing a role', go: (token) => patch(token, READER, 'write') },
    {
      what: 'taking somebody out',
      go: (token) => call(env, `/v1/spaces/${space}/share/members/${READER}`, { method: 'DELETE', token }),
    },
    {
      what: 'setting the link',
      go: (token) =>
        call(env, `/v1/spaces/${space}/share/link`, { method: 'PUT', token, body: { role: 'read', mode: 'open' } }),
    },
    {
      what: 'taking the link away',
      go: (token) => call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token }),
    },
    {
      what: 'letting a request in',
      go: (token) => call(env, `/v1/spaces/${space}/share/requests/${NEWCOMER}`, { method: 'POST', token }),
    },
    {
      what: 'turning a request away',
      go: (token) => call(env, `/v1/spaces/${space}/share/requests/${NEWCOMER}`, { method: 'DELETE', token }),
    },
    {
      what: 'letting a guest in',
      go: (token) => call(env, `/v1/spaces/${space}/share/guests/nobody`, { method: 'POST', token }),
    },
    {
      what: "changing a guest's role",
      go: (token) =>
        call(env, `/v1/spaces/${space}/share/guests/nobody`, { method: 'PATCH', token, body: { role: 'read' } }),
    },
    {
      what: 'taking a guest out',
      go: (token) => call(env, `/v1/spaces/${space}/share/guests/nobody`, { method: 'DELETE', token }),
    },
    {
      what: 'renaming the space',
      readerHears: 'you can only read this space',
      go: (token) => call(env, `/v1/spaces/${space}`, { method: 'PATCH', token, body: { name: 'Mine now' } }),
    },
  ]
  for (const route of ROUTES) {
    test(`may not be ${route.what}`, async () => {
      for (const token of [writer, reader]) {
        const answer = await route.go(token)
        expect(answer.status, route.what).toBe(403)
        expect(answer.json.error, route.what).toBe(token === reader ? (route.readerHears ?? ONLY) : ONLY)
      }
    })
  }
  test('reads who is in the space, without the link or anybody waiting', async () => {
    await call(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'approval' },
    })
    const link = (await view(owner)).json.link?.url ?? ''
    const token = /\/join\/([a-f0-9]+)/.exec(link)?.[1] ?? ''
    await call(env, `/v1/join/${token}`, { method: 'POST', token: await signIn(env, NEWCOMER) })
    await call(env, `/v1/join/${token}`, { method: 'POST', body: { name: 'Wren' } })
    expect((await view(owner)).json.requests).toHaveLength(2)
    for (const one of [writer, reader]) {
      const shown = await view(one)
      expect(shown.status).toBe(200)
      expect(shown.json.owner.email).toBe(OWNER)
      expect(shown.json.members.map((each) => each.email)).toEqual([ADMIN, WRITER, READER])
      expect(shown.json.link).toBeNull()
      expect(shown.json.requests).toEqual([])
    }
  })
  test('may not read who a note on its own is shared with', async () => {
    expect((await view(writer, note)).status).toBe(403)
  })
  test('still gives the space an icon', async () => {
    const answer = await call(env, `/v1/spaces/${space}`, { method: 'PATCH', token: writer, body: { icon: 'Book' } })
    expect(answer.status).toBe(200)
    expect(answer.json.space).toMatchObject({ icon: 'Book', admin: false })
  })
})
