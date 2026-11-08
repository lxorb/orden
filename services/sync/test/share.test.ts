import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { type PullResponse, type PushResponse, seedUpdate } from '@orden/sync-core'
import { TEXT } from '@orden/rooms'
import * as Y from 'yjs'
import { MOST_MEMBERS } from '../src/spaces/share'
import { call, mail, signIn, testEnv, type JoinView, type ShareView, type TestEnv } from './harness'
import { framed, live } from './sync2'

const NO_FACE = { id: null, avatar: null, accent: null }
const A_FACE = { id: expect.any(String), avatar: null, accent: null }

const OWNER = 'owner@example.com'
const WRITER = 'writer@example.com'
const READER = 'reader@example.com'
const STRANGER = 'nobody@example.com'

let env: TestEnv
let owner: string
let writer: string
let reader: string
let stranger: string
let space: string
let note: string
let guestWriter: string
let guestReader: string
let waitingGuest: string
let readingGuest: string

async function invite(email: string, role: 'write' | 'read'): Promise<string> {
  const link = await inviteLink(email, role)
  const token = await signIn(env, email)
  await call(env, `/v1/join/${link}`, { method: 'POST', token })
  return token
}

async function inviteLink(email: string, role: 'write' | 'read'): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite`, { token: owner, body: { email, role } }),
  )

  const found = /\/join\/([a-f0-9]+)/.exec(sent)
  if (!found?.[1]) throw new Error(`no invitation was sent:\n${sent}`)
  return found[1]
}

function shareView(as = owner) {
  return call<ShareView>(env, `/v1/spaces/${space}/share`, { token: as })
}

async function shareLink(role: 'write' | 'read', mode: 'open' | 'approval'): Promise<string> {
  const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
    method: 'PUT',
    token: owner,
    body: { role, mode },
  })

  const found = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')
  if (!found?.[1]) throw new Error('no link was made')
  return found[1]
}

async function guestAt(role: 'write' | 'read', device = 'Windows'): Promise<string> {
  const token = await shareLink(role, 'open')
  const { json } = await call(env, `/v1/join/${token}`, { method: 'POST', body: { device } })

  return json.token
}

async function guestOf(token: string): Promise<string> {
  return (await call(env, '/v1/me', { token })).json.guest.id
}

const SHARED = 'Plans'

beforeEach(async () => {
  env = testEnv()
  live(env)
  owner = await signIn(env, OWNER)
  stranger = await signIn(env, STRANGER)

  space = (await call(env, '/v1/spaces', { token: owner, body: { name: SHARED } })).json.space.id
  note = (
    await call(env, `/v1/spaces/${space}/notes`, {
      token: owner,
      body: { path: 'plan.md', content: '# Plan\n' },
    })
  ).json.note.id
})

afterEach(() => env.close())

interface Route {
  what: string
  needs: 'read' | 'write' | 'owner'
  go: (token: string) => Promise<{ status: number }>
}

const ROUTES: Route[] = [
  {
    what: 'reading what changed',
    needs: 'read',
    go: (token) => call(env, `/v1/spaces/${space}/changes?since=0`, { token }),
  },
  {
    what: 'reading a note',
    needs: 'read',
    go: (token) => call(env, `/v1/notes/${note}`, { token }),
  },
  {
    what: 'making a note',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'new.md', content: 'hi' } }),
  },
  {
    what: 'writing a note',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/notes/${note}`, { method: 'PUT', token, body: { content: 'changed' } }),
  },
  {
    what: 'deleting a note',
    needs: 'write',
    go: (token) => call(env, `/v1/notes/${note}`, { method: 'DELETE', token }),
  },
  {
    what: 'keeping bookmarks',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/bookmarks`, { method: 'PUT', token, body: { bookmarks: [] } }),
  },
  {
    what: 'dressing the folders',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/icons`, { method: 'PUT', token, body: { icons: {} } }),
  },
  {
    what: 'arranging the folders',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/arranged`, {
        method: 'PUT',
        token,
        body: { arranged: { '': ['b.md', 'a.md'] } },
      }),
  },
  {
    what: 'drawing the graph',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/graph`, { method: 'PUT', token, body: { graph: {} } }),
  },
  {
    what: 'leaving a note out of the search',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/excluded`, { method: 'PUT', token, body: { excluded: [] } }),
  },
  {
    what: 'putting a note away',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/archived`, {
        method: 'PUT',
        token,
        body: { archived: { 'Plan.md': 1 } },
      }),
  },
  {
    what: 'keeping the files beside the notes',
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}/files`, { method: 'PUT', token, body: { files: [] } }),
  },
  {
    what: "choosing the space's icon",
    needs: 'write',
    go: (token) =>
      call(env, `/v1/spaces/${space}`, {
        method: 'PATCH',
        token,
        body: { icon: 'Book', tint: 'red' },
      }),
  },
  {
    what: 'renaming the space with its icon',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}`, {
        method: 'PATCH',
        token,
        body: { name: 'X', icon: 'Book' },
      }),
  },
  {
    what: 'renaming the space',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}`, { method: 'PATCH', token, body: { name: 'X' } }),
  },
  {
    what: 'deleting the space',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}`, { method: 'DELETE', token }),
  },
  {
    what: 'publishing the space',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/blog`, { method: 'PUT', token, body: { subdomain: 'plans' } }),
  },
  {
    what: 'unpublishing the space',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token }),
  },
  {
    what: 'asking after the domain',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/blog/domain`, { token }),
  },
  {
    what: 'reading who else is in it',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/share`, { token }),
  },
  {
    what: 'inviting somebody',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token,
        body: { email: 'else@example.com', role: 'read' },
      }),
  },
  {
    what: "changing somebody's role",
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/members/${READER}`, {
        method: 'PATCH',
        token,
        body: { role: 'write' },
      }),
  },
  {
    what: 'taking somebody out',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/members/${READER}`, { method: 'DELETE', token }),
  },
  {
    what: 'making the link',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/link`, {
        method: 'PUT',
        token,
        body: { role: 'read', mode: 'open' },
      }),
  },
  {
    what: 'revoking the link',
    needs: 'owner',
    go: (token) => call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token }),
  },
  {
    what: 'accepting a request',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, { method: 'POST', token }),
  },
  {
    what: 'declining a request',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, { method: 'DELETE', token }),
  },
  {
    what: 'letting a guest in',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/guests/${waitingGuest}`, { method: 'POST', token }),
  },
  {
    what: "changing a guest's role",
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/guests/${readingGuest}`, {
        method: 'PATCH',
        token,
        body: { role: 'write' },
      }),
  },
  {
    what: 'taking a guest out',
    needs: 'owner',
    go: (token) =>
      call(env, `/v1/spaces/${space}/share/guests/${readingGuest}`, { method: 'DELETE', token }),
  },
]

async function fileEntry(): Promise<{ id: string; hash: string }> {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)].map((one) => one.toString(16).padStart(2, '0')).join('')
  await call(env, `/v2/blobs/${hash}`, {
    method: 'PUT',
    token: owner,
    raw: bytes,
    headers: { 'content-type': 'audio/webm' },
  })
  const kind = 'file'
  await call(env, `/v2/spaces/${space}/ops`, {
    token: owner,
    body: {
      ops: [
        { op: 'file', t: 'create', id: 'file', kind, parent: null, name: 'a.webm', hash, seen: 0 },
      ],
    },
  })
  return { id: 'file', hash }
}

ROUTES.push(
  {
    what: 'reading what changed, the way sync v2 reads it',
    needs: 'read',
    go: (token) => call(env, `/v2/spaces/${space}/feed?since=0`, { token }),
  },
  {
    what: 'reading the documents in bulk',
    needs: 'read',
    go: (token) => call(env, `/v2/spaces/${space}/snapshot`, { token }),
  },
  {
    what: 'making the tree into rows',
    needs: 'read',
    go: (token) => call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' }),
  },
  {
    what: "reading the space's maps",
    needs: 'read',
    go: (token) => call(env, `/v2/spaces/${space}/maps?since=0`, { token }),
  },
  {
    what: "changing the space's maps",
    needs: 'write',
    go: (token) =>
      call(env, `/v2/spaces/${space}/maps`, {
        method: 'PATCH',
        token,
        body: { entries: [{ map: 'graph', key: 'orphans', value: true }] },
      }),
  },
  {
    what: 'fetching a file',
    needs: 'read',
    go: async (token) => call(env, `/v2/files/${space}/${(await fileEntry()).id}`, { token }),
  },
  {
    what: 'replacing a file',
    needs: 'write',
    go: async (token) => {
      const { id, hash } = await fileEntry()
      return call(env, `/v2/files/${space}/${id}`, {
        method: 'PUT',
        token,
        body: { hash, base: hash },
      })
    },
  },
  {
    what: 'keeping the other side of an answer as a version',
    needs: 'write',
    go: (token) =>
      call(env, '/v2/docs/keep', { token, body: { id: note, text: 'kept', device: 'Laptop' } }),
  },
)

const RANK = { read: 0, write: 1, owner: 2 }

const HOLDERS: { as: string; role: 'read' | 'write' | 'owner'; token: () => string }[] = [
  { as: 'the owner', role: 'owner', token: () => owner },
  { as: 'a writer', role: 'write', token: () => writer },
  { as: 'a reader', role: 'read', token: () => reader },
  { as: 'a guest who may write', role: 'write', token: () => guestWriter },
  { as: 'a guest who may read', role: 'read', token: () => guestReader },
]

describe("a shared space's icon", () => {
  test("a member with full access sets it for everyone in the space, and the name stays the owner's", async () => {
    writer = await invite(WRITER, 'write')
    reader = await invite(READER, 'read')

    const set = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token: writer,
      body: { icon: 'Rocket', tint: 'blue' },
    })
    expect(set.status).toBe(200)
    expect(set.json.space).toMatchObject({ icon: 'Rocket', tint: 'blue', role: 'write' })
    expect(set.json.space.blog.dns).toEqual([])

    for (const token of [owner, writer, reader]) {
      const listed = await call(env, '/v1/spaces', { token })
      expect(listed.json.spaces.find((one: { id: string }) => one.id === space)).toMatchObject({
        name: SHARED,
        icon: 'Rocket',
        tint: 'blue',
      })
    }

    const named = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token: writer,
      body: { name: 'Theirs', icon: 'Book' },
    })
    expect(named.status).toBe(403)
    const kept = await call(env, '/v1/spaces', { token: owner })
    expect(kept.json.spaces.find((one: { id: string }) => one.id === space)).toMatchObject({
      name: SHARED,
      icon: 'Rocket',
    })
  })

  test('a member who may only read cannot change it', async () => {
    reader = await invite(READER, 'read')

    const set = await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token: reader,
      body: { icon: 'Rocket' },
    })
    expect(set.status).toBe(403)
  })
})

describe('every route that names a space', () => {
  beforeEach(async () => {
    writer = await invite(WRITER, 'write')
    reader = await invite(READER, 'read')

    guestWriter = await guestAt('write')
    guestReader = await guestAt('read')
    readingGuest = await guestOf(guestReader)

    const asking = await shareLink('read', 'approval')
    await call(env, `/v1/join/${asking}`, { method: 'POST', token: stranger })

    const knocked = await call(env, `/v1/join/${asking}`, {
      method: 'POST',
      body: { name: 'Ada' },
    })
    waitingGuest = knocked.json.guest.id
  })

  for (const route of ROUTES) {
    for (const holder of HOLDERS) {
      const allowed = RANK[holder.role] >= RANK[route.needs]

      test(`${allowed ? 'lets' : 'refuses'} ${holder.as} through ${route.what}`, async () => {
        const { status } = await route.go(holder.token())

        if (allowed) expect(status).toBeLessThan(400)
        else expect(status).toBe(403)
      })
    }

    test(`answers a stranger asking about ${route.what} with nothing at all`, async () => {
      const { status } = await route.go(stranger)
      expect(status).toBe(404)
    })
  }

  const ITEMS: {
    what: string
    needs: 'read' | 'write'
    go: (token: string) => Promise<{ status: number; result: Record<string, unknown> | undefined }>
  }[] = [
    {
      what: 'changing the tree',
      needs: 'write',
      go: async (token) => {
        const answer = await call<{ results?: Record<string, unknown>[] }>(
          env,
          `/v2/spaces/${space}/ops`,
          {
            token,
            body: {
              ops: [
                {
                  op: `mk-${token.slice(0, 8)}`,
                  t: 'mkdir',
                  id: `f-${token.slice(0, 8)}`,
                  parent: null,
                  name: `F ${token.slice(0, 8)}`,
                  seen: 0,
                },
              ],
            },
          },
        )
        return { status: answer.status, result: answer.json.results?.[0] }
      },
    },
    {
      what: 'pushing what a device wrote',
      needs: 'write',
      go: async (token) => {
        const doc = new Y.Doc()
        Y.applyUpdateV2(doc, seedUpdate(note, 1, '# Plan\n'))
        const base = Y.encodeStateVector(doc)
        doc.getText(TEXT).insert(0, 'x')
        const update = Y.encodeStateAsUpdateV2(doc, base)
        const answer = await framed<PushResponse>(env, '/v2/docs/push', token, {
          docs: [
            { id: note, push: `p-${token.slice(0, 8)}`, epoch: 1, seq: 1, base, update, at: 1 },
          ],
        })
        return {
          status: answer.status,
          result: answer.value.docs[0] as Record<string, unknown> | undefined,
        }
      },
    },
    {
      what: 'pulling what a document says',
      needs: 'read',
      go: async (token) => {
        const answer = await framed<PullResponse>(env, '/v2/docs/pull', token, {
          docs: [{ id: note, epoch: 1, sv: Y.encodeStateVector(new Y.Doc()) }],
        })
        return {
          status: answer.status,
          result: answer.value.docs[0] as Record<string, unknown> | undefined,
        }
      },
    },
  ]

  for (const item of ITEMS) {
    for (const holder of HOLDERS) {
      const allowed = RANK[holder.role] >= RANK[item.needs]

      test(`${allowed ? 'lets' : 'refuses'} ${holder.as} through ${item.what}`, async () => {
        const { status, result } = await item.go(holder.token())
        expect(status).toBe(200)
        if (allowed) expect(result).not.toHaveProperty('refused')
        else expect(result).toMatchObject({ refused: 'role' })
      })
    }

    test(`answers a stranger asking about ${item.what} with nothing at all`, async () => {
      const { status, result } = await item.go(stranger)
      if (status === 200) expect(result).toMatchObject({ refused: 'gone' })
      else expect(status).toBe(404)
    })
  }
})

describe('the space listing', () => {
  async function inRail(as: string) {
    const { json } = await call(env, '/v1/spaces', { token: as })
    return json.spaces.find((one) => one.id === space)
  }

  test('says nothing is shared until somebody is in it', async () => {
    expect((await inRail(owner))?.role).toBe('owner')
    expect((await inRail(owner))?.shared).toBe(false)
  })

  test("marks the owner's space once somebody is in it", async () => {
    await invite(READER, 'read')

    expect((await inRail(owner))?.shared).toBe(true)
  })

  test('carries a shared space to the person it was shared with, with their role', async () => {
    reader = await invite(READER, 'read')

    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => [one.name, one.role, one.shared])).toEqual([
      ['Notes', 'owner', false],
      [SHARED, 'read', true],
    ])
  })

  test('keeps a shared space after the ones the account owns', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, '/v1/spaces', { token: writer, body: { name: 'Mine' } })

    const { json } = await call(env, '/v1/spaces', { token: writer })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', 'Mine', SHARED])
  })

  test('leaves nothing of a space nobody shared', async () => {
    const { json } = await call(env, '/v1/spaces', { token: stranger })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('carries the marker for a shared space that was deleted', async () => {
    reader = await invite(READER, 'read')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token: owner })

    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
    expect(json.deleted).toEqual([space])
  })

  test('drops the space the moment the membership is taken away', async () => {
    reader = await invite(READER, 'read')
    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'DELETE',
      token: owner,
    })

    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('reorders only what the account owns, so a rail cannot move somebody else’s', async () => {
    writer = await invite(WRITER, 'write')
    const mine = (await call(env, '/v1/spaces', { token: writer, body: { name: 'Mine' } })).json
      .space.id

    await call(env, '/v1/spaces/order', {
      method: 'PUT',
      token: writer,
      body: { order: [space, mine] },
    })

    const { json } = await call(env, '/v1/spaces', { token: owner })
    expect(json.spaces[0]?.position).toBe(0)
  })
})

describe('an invitation', () => {
  test('puts the person in the space and mails them a link', async () => {
    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'read' },
      }),
    )

    expect(sent).toContain(READER)
    expect(sent).toContain(`shared the space ${SHARED} with you`)
    expect(sent).toMatch(/https:\/\/orden\.so\/join\/[a-f0-9]{64}/)

    const { json } = await shareView()
    expect(json.members).toEqual([
      { ...NO_FACE, email: READER, guest: null, name: null, role: 'read', pending: true },
    ])
  })

  test('waits for the address to be proved before anybody has been in', async () => {
    const link = await inviteLink(READER, 'read')
    expect((await shareView()).json.members[0]?.pending).toBe(true)

    const token = await signIn(env, READER)
    await call(env, `/v1/join/${link}`, { method: 'POST', token })

    expect((await shareView()).json.members[0]?.pending).toBe(false)
  })

  test('is waiting for somebody who had no account when it was sent', async () => {
    await inviteLink('later@example.com', 'write')

    const token = await signIn(env, 'later@example.com')
    const { json } = await call(env, '/v1/spaces', { token })

    expect(json.spaces.map((one) => [one.name, one.role])).toEqual([
      ['Notes', 'owner'],
      [SHARED, 'write'],
    ])
  })

  test('reads the address the way the sign-in does, so one spelling is one person', async () => {
    await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: '  Reader@Example.COM ', role: 'read' },
    })

    const token = await signIn(env, READER)
    const { json } = await call(env, '/v1/spaces', { token })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('says what is wrong with an address that is not one', async () => {
    const { status, json } = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: 'not an address', role: 'read' },
    })

    expect(status).toBe(400)
    expect(json.error).toBe('enter a valid email address')
  })

  test('refuses a role that is not one to give', async () => {
    for (const role of ['owner', 'admin', '']) {
      const { status } = await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role },
      })
      expect(status, role).toBe(400)
    }
  })

  test('will not invite the owner to their own space', async () => {
    const { status, json } = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: OWNER, role: 'write' },
    })

    expect(status).toBe(409)
    expect(json.error).toBe('this space is already yours')
  })

  test('mails one address at a time, the way a sign-in code is rate limited', async () => {
    const sent = await mail(async () => {
      await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'read' },
      })
      await call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'write' },
      })
    })

    expect(sent.match(/shared the space Plans with you/g)).toHaveLength(1)
    expect((await shareView()).json.members[0]?.role).toBe('write')
  })

  test('never says whether the mail went, which would say who else had mailed them', async () => {
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: READER, role: 'read' },
    })

    expect(json.mailed).toBeUndefined()
  })

  test('stands, and still says nothing, when the message cannot go', async () => {
    env.MAIL_FROM = 'Nib <nib@nibeditor.com>'
    env.EMAIL = { send: () => Promise.reject(new Error('the sender is not answering')) }

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await call<ShareView>(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: STRANGER, role: 'read' },
    })
    quiet.mockRestore()

    expect(response.status).toBe(200)
    expect(response.json.members.some((one) => one.email === STRANGER)).toBe(true)

    const gap = env.db
      .prepare('select count(*) as many from mailed where email = ?')
      .get(STRANGER) as { many: number }
    expect(gap.many).toBe(0)
  })

  test('carries a space name that is one line, whatever the name holds', async () => {
    await call(env, `/v1/spaces/${space}`, {
      method: 'PATCH',
      token: owner,
      body: { name: 'Plans\r\nBcc: somebody@example.com' },
    })

    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: owner,
        body: { email: READER, role: 'read' },
      }),
    )

    const subject = /- (.*)/.exec(sent)?.[1] ?? ''
    expect(subject).toBe('owner shared PlansBcc: somebody@example.com with you')
  })

  test('opens nothing when it reaches somebody else', async () => {
    const link = await inviteLink(READER, 'read')

    const { status, json } = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      token: stranger,
    })

    expect(status).toBe(403)
    expect(json.error).toBe('that invitation was sent to another address')
  })

  test('says who it is from and what it offers, before anybody has signed in', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token: owner, body: { name: 'Emil' } })
    const link = await inviteLink(READER, 'read')

    const { status, json } = await call<JoinView>(env, `/v1/join/${link}`)

    expect(status).toBe(200)
    expect(json).toMatchObject({
      kind: 'invite',
      space: SHARED,
      role: 'read',
      email: READER,
      asks: false,
      from: 'Emil',
    })
  })

  test('names the owner by the front of their address until they choose a name', async () => {
    const link = await inviteLink(READER, 'read')
    expect((await call<JoinView>(env, `/v1/join/${link}`)).json.from).toBe('owner')
  })

  test('lets nobody in once it is taken back while being followed', async () => {
    const link = await inviteLink(STRANGER, 'write')
    env.justBefore(/into space_members|update space_members set joined_at/, () =>
      env.db.prepare('delete from space_members where email = ?').run(STRANGER),
    )

    const joined = await call(env, `/v1/join/${link}`, { method: 'POST', token: stranger })

    expect(joined.status).toBe(404)
    expect(
      env.db.prepare('select count(*) as n from space_members where email = ?').get(STRANGER),
    ).toEqual({ n: 0 })
  })

  test('opens one sign-in when it is followed twice at once', async () => {
    const link = await inviteLink('fresh@example.com', 'read')
    const sessions = () =>
      (env.db.prepare('select count(*) as n from sessions').get() as { n: number }).n
    const before = sessions()

    const answers = await Promise.all(
      [0, 1].map(() => call(env, `/v1/join/${link}`, { method: 'POST' })),
    )

    expect(answers.map((one) => one.status).sort()).toEqual([200, 404])
    expect(sessions() - before).toBe(1)
  })

  test('stops being a shortcut once it has run out', async () => {
    const link = await inviteLink(READER, 'read')
    env.db.exec('update space_members set expires_at = 1')

    expect((await call<JoinView>(env, `/v1/join/${link}`)).status).toBe(404)

    const token = await signIn(env, READER)
    const { json } = await call(env, '/v1/spaces', { token })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })
})

describe('one person’s role', () => {
  beforeEach(async () => {
    reader = await invite(READER, 'read')
  })

  test('changes on its own, leaving everybody else where they were', async () => {
    writer = await invite(WRITER, 'write')

    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'write' },
    })

    const { json } = await shareView()
    expect(Object.fromEntries(json.members.map((one) => [one.email, one.role]))).toEqual({
      [WRITER]: 'write',
      [READER]: 'write',
    })
  })

  test('takes effect at once, so the next write is allowed', async () => {
    const before = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: reader,
      body: { content: 'mine' },
    })
    expect(before.status).toBe(403)

    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'write' },
    })

    const after = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: reader,
      body: { content: 'mine' },
    })
    expect(after.status).toBe(200)
  })

  test('cannot be raised to owner', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'owner' },
    })

    expect(status).toBe(400)
  })

  test('says so when nobody by that address is in the space', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/members/${STRANGER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'write' },
    })

    expect(status).toBe(404)
  })

  test('ends when they let themselves out, without asking the owner', async () => {
    const gone = await call(env, `/v1/spaces/${space}/share/me`, {
      method: 'DELETE',
      token: reader,
    })
    expect(gone.status).toBe(200)

    expect((await shareView()).json.members).toEqual([])
    const { json } = await call(env, '/v1/spaces', { token: reader })
    expect(json.spaces.map((one) => one.name)).toEqual(['Notes'])
  })

  test('is not something the owner can do to their own space', async () => {
    const { status, json } = await call(env, `/v1/spaces/${space}/share/me`, {
      method: 'DELETE',
      token: owner,
    })

    expect(status).toBe(409)
    expect(json.error).toBe('this space is yours')
    const { json: rail } = await call(env, '/v1/spaces', { token: owner })
    expect(rail.spaces.map((one) => one.name)).toEqual(['Notes', SHARED])
  })

  test('is nothing at all for somebody who was never in it', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/me`, {
      method: 'DELETE',
      token: stranger,
    })

    expect(status).toBe(404)
  })

  test('goes when they are taken out, and the space goes with it', async () => {
    await call(env, `/v1/spaces/${space}/share/members/${READER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect((await shareView()).json.members).toEqual([])
    expect((await call(env, `/v1/notes/${note}`, { token: reader })).status).toBe(404)
  })
})

describe('as many people as one space holds', () => {
  function fillMembers(spare = 0) {
    const at = Date.now()
    for (let one = 0; one < MOST_MEMBERS - spare; one++) {
      env.db
        .prepare(
          'insert into space_members (space_id, email, role, created_at) values (?, ?, ?, ?)',
        )
        .run(space, `filler${one}@example.com`, 'read', at + one)
    }
  }

  test('an invitation is refused past it', async () => {
    fillMembers()
    const response = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: STRANGER, role: 'read' },
    })

    expect(response.status).toBe(409)
    expect(response.json.error).toBe('that is as many people as one space holds')
  })

  test('an open link is refused past it too', async () => {
    const token = await shareLink('write', 'open')
    fillMembers()

    const joined = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })
    expect(joined.status).toBe(409)
    expect(joined.json.error).toBe('that is as many people as one space holds')

    expect((await shareView()).json.members).toHaveLength(MOST_MEMBERS)
  })

  test('somebody already in is still let in when it is full', async () => {
    const token = await shareLink('read', 'open')
    fillMembers(1)
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    const again = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })
    expect(again.status).toBe(200)
    expect(again.json.space.role).toBe('read')
  })

  test('an invitation already written is still redeemable when it is full', async () => {
    const link = await inviteLink(STRANGER, 'write')
    fillMembers(1)

    const joined = await call(env, `/v1/join/${link}`, { method: 'POST', token: stranger })
    expect(joined.status).toBe(200)
    expect(joined.json.space.role).toBe('write')
  })
  function held(table: 'space_members' | 'space_requests'): number {
    const row = env.db
      .prepare(`select count(*) as n from ${table} where space_id = ?`)
      .get(space) as { n: number }
    return row.n
  }

  test('lets nobody in past it when somebody else got in just before', async () => {
    const token = await shareLink('read', 'open')
    fillMembers(1)
    env.justBefore(/insert into space_members/, () => {
      env.db
        .prepare(
          'insert into space_members (space_id, email, role, created_at) values (?, ?, ?, ?)',
        )
        .run(space, 'quicker@example.com', 'read', Date.now())
    })

    const joined = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    expect(joined.status).toBe(409)
    expect(held('space_members')).toBe(MOST_MEMBERS)
  })

  test('writes no more invitations than it holds when many are sent at once', async () => {
    fillMembers(1)

    const answers = await Promise.all(
      [0, 1, 2, 3].map((one) =>
        call(env, `/v1/spaces/${space}/share/invite`, {
          token: owner,
          body: { email: `asked${one}@example.com`, role: 'read' },
        }),
      ),
    )

    expect(held('space_members')).toBe(MOST_MEMBERS)
    expect(answers.filter((one) => one.status === 409)).toHaveLength(3)
  })

  test('lets nobody waiting in once it is full', async () => {
    const token = await shareLink('read', 'approval')
    const asked = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })
    expect(asked.json.waiting).toBe(true)
    fillMembers()

    const admitted = await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    expect(admitted.status).toBe(409)
    expect(admitted.json.error).toBe('that is as many people as one space holds')
    expect(held('space_members')).toBe(MOST_MEMBERS)
  })

  test('keeps nobody waiting past it when somebody else asked just before', async () => {
    const token = await shareLink('read', 'approval')
    const at = Date.now()
    const ask = (email: string, when: number) =>
      env.db
        .prepare(
          'insert into space_requests (space_id, email, role, created_at) values (?, ?, ?, ?)',
        )
        .run(space, email, 'read', when)
    for (let one = 0; one < MOST_MEMBERS - 1; one++) ask(`waiting${one}@example.com`, at + one)
    env.justBefore(/insert into space_requests/, () => ask('quicker@example.com', at))

    const asked = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    expect(asked.status).toBe(429)
    expect(held('space_requests')).toBe(MOST_MEMBERS)
  })

  test('lets no waiting guest in once guests fill it', async () => {
    const token = await shareLink('read', 'approval')
    const asked = await call(env, `/v1/join/${token}`, { method: 'POST', body: { name: 'Wren' } })
    expect(asked.json.waiting).toBe(true)
    const guest = await guestOf(asked.json.token)
    const long = Date.now() - 10 * 60_000
    for (let one = 0; one < 200; one++) {
      env.db
        .prepare('insert into guests (id, name, created_at) values (?, ?, ?)')
        .run(`filler-guest-${String(one)}`, 'Filler', long)
      env.db
        .prepare(
          `insert into guest_members (space_id, guest_id, role, joined_at, created_at)
           values (?, ?, 'read', ?, ?)`,
        )
        .run(space, `filler-guest-${String(one)}`, long, long)
    }

    const admitted = await call(env, `/v1/spaces/${space}/share/guests/${guest}`, {
      method: 'POST',
      token: owner,
    })

    expect(admitted.status).toBe(409)
    expect(admitted.json.error).toBe('that is as many people as one space holds')
    const joined = env.db
      .prepare(
        'select count(*) as n from guest_members where space_id = ? and joined_at is not null',
      )
      .get(space) as { n: number }
    expect(joined.n).toBe(200)
  })

  test('leaves a guest out who is declined just as they are let in elsewhere', async () => {
    const token = await shareLink('read', 'approval')
    const asked = await call(env, `/v1/join/${token}`, { method: 'POST', body: { name: 'Wren' } })
    const guest = await guestOf(asked.json.token)
    env.justBefore(/update guest_members set declined_at/, () =>
      env.db
        .prepare('update guest_members set joined_at = ? where guest_id = ?')
        .run(Date.now(), guest),
    )

    await call(env, `/v1/spaces/${space}/share/guests/${guest}`, { method: 'DELETE', token: owner })

    expect(
      env.db
        .prepare(
          'select count(*) as n from guest_members where guest_id = ? and joined_at is not null',
        )
        .get(guest),
    ).toEqual({ n: 0 })
  })

  test('lets in no more guests than it holds when many come at once', async () => {
    const token = await shareLink('read', 'open')
    const long = Date.now() - 10 * 60_000
    for (let one = 0; one < 199; one++) {
      env.db
        .prepare('insert into guests (id, name, created_at) values (?, ?, ?)')
        .run(`filler-guest-${String(one)}`, 'Filler', long)
      env.db
        .prepare(
          `insert into guest_members (space_id, guest_id, role, joined_at, created_at)
           values (?, ?, 'read', ?, ?)`,
        )
        .run(space, `filler-guest-${String(one)}`, long, long)
    }
    const guestsBefore = (env.db.prepare('select count(*) as n from guests').get() as { n: number })
      .n

    const answers = await Promise.all(
      [0, 1, 2].map(() =>
        call(env, `/v1/join/${token}`, { method: 'POST', body: { device: 'Windows' } }),
      ),
    )

    const joined = env.db
      .prepare(
        'select count(*) as n from guest_members where space_id = ? and joined_at is not null',
      )
      .get(space) as { n: number }
    expect(joined.n).toBe(200)
    expect(answers.filter((one) => one.status === 429)).toHaveLength(2)
    const guestsAfter = (env.db.prepare('select count(*) as n from guests').get() as { n: number })
      .n
    expect(guestsAfter - guestsBefore).toBe(1)
  })
})

describe('a share link', () => {
  async function link(role: 'write' | 'read', mode: 'open' | 'approval'): Promise<string> {
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role, mode },
    })

    const found = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')
    if (!found?.[1]) throw new Error('no link was made')
    return found[1]
  }

  test('is not there until it is asked for', async () => {
    expect((await shareView()).json.link).toBeNull()
  })

  test('lets anybody who proves an address in, when it is open', async () => {
    const token = await link('write', 'open')
    const joined = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    expect(joined.status).toBe(200)
    expect(joined.json.space.role).toBe('write')

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: stranger,
      body: { content: 'from the link' },
    })
    expect(wrote.status).toBe(200)
  })

  test('says what it offers to somebody who has not signed in', async () => {
    const token = await link('read', 'open')
    const { json } = await call<JoinView>(env, `/v1/join/${token}`)

    expect(json).toMatchObject({ kind: 'link', space: SHARED, role: 'read', asks: false })
    expect(json.email).toBeNull()
  })

  test('asks first when it is set to, and tells the owner somebody is waiting', async () => {
    const token = await link('read', 'approval')

    const sent = await mail(() =>
      call(env, `/v1/join/${token}`, { method: 'POST', token: stranger }),
    )
    expect(sent).toContain(OWNER)
    expect(sent).toContain(`would like to join ${SHARED}`)

    const { json } = await shareView()
    expect(json.requests.map((one) => [one.email, one.role])).toEqual([[STRANGER, 'read']])
    expect(json.members).toEqual([])

    expect((await call(env, `/v1/notes/${note}`, { token: stranger })).status).toBe(404)
  })

  test('says it is waiting rather than handing back a space', async () => {
    const token = await link('read', 'approval')
    const { json } = await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    expect(json.waiting).toBe(true)
    expect(json.space).toBeUndefined()
  })

  test('lets somebody in once the owner accepts, at the role the link offered', async () => {
    const token = await link('write', 'approval')
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    const { json } = await shareView()
    expect(json.requests).toEqual([])
    expect(json.members).toEqual([
      { ...A_FACE, email: STRANGER, guest: null, name: null, role: 'write', pending: false },
    ])

    const wrote = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: stranger,
      body: { content: 'let in' },
    })
    expect(wrote.status).toBe(200)
  })

  test('leaves them outside when the owner declines', async () => {
    const token = await link('read', 'approval')
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'DELETE',
      token: owner,
    })

    const { json } = await shareView()
    expect(json.requests).toEqual([])
    expect(json.members).toEqual([])
  })

  test('accepting says they have arrived even over a membership that was waiting', async () => {
    const at = Date.now()
    env.db
      .prepare('insert into space_members (space_id, email, role, created_at) values (?, ?, ?, ?)')
      .run(space, STRANGER, 'read', at)
    env.db
      .prepare('insert into space_requests (space_id, email, role, created_at) values (?, ?, ?, ?)')
      .run(space, STRANGER, 'write', at)

    expect((await shareView()).json.members[0]?.pending).toBe(true)

    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    const { json } = await shareView()
    expect(json.requests).toEqual([])
    expect(json.members).toEqual([
      { ...A_FACE, email: STRANGER, guest: null, name: null, role: 'write', pending: false },
    ])
  })

  test('keeps what a request was promised when the link changes afterwards', async () => {
    const token = await link('write', 'approval')
    await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })

    await call(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'approval' },
    })
    await call(env, `/v1/spaces/${space}/share/requests/${STRANGER}`, {
      method: 'POST',
      token: owner,
    })

    expect((await shareView()).json.members[0]?.role).toBe('write')
  })

  test('stays the same link when what it hands out changes', async () => {
    const first = await link('read', 'open')
    const second = await link('write', 'approval')

    expect(second).toBe(first)
    expect((await shareView()).json.link).toMatchObject({ role: 'write', mode: 'approval' })
  })

  test('opens nothing once it is revoked', async () => {
    const token = await link('read', 'open')
    await call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token: owner })

    expect((await shareView()).json.link).toBeNull()
    expect((await call(env, `/v1/join/${token}`)).status).toBe(404)
    expect((await call(env, `/v1/join/${token}`, { method: 'POST', token: stranger })).status).toBe(
      404,
    )
  })

  test('is a fresh one when a revoked space is shared again', async () => {
    const first = await link('read', 'open')
    await call(env, `/v1/spaces/${space}/share/link`, { method: 'DELETE', token: owner })
    const second = await link('read', 'open')

    expect(second).not.toBe(first)
  })

  test('hands the owner their own space rather than making them a member of it', async () => {
    const token = await link('read', 'open')
    const { json } = await call(env, `/v1/join/${token}`, { method: 'POST', token: owner })

    expect(json.space.role).toBe('owner')
    expect((await shareView()).json.members).toEqual([])
  })

  test('refuses a mode that is not one', async () => {
    const { status } = await call(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'sometimes' },
    })

    expect(status).toBe(400)
  })

  test('is nothing at all when the token names nothing', async () => {
    expect((await call(env, '/v1/join/deadbeef')).status).toBe(404)
    expect((await call(env, '/v1/join/deadbeef', { method: 'POST', token: stranger })).status).toBe(
      404,
    )
  })

  test('needs no session at all: it hands out a guest instead', async () => {
    const token = await link('read', 'open')
    const { status, json } = await call(env, `/v1/join/${token}`, { method: 'POST' })

    expect(status).toBe(200)
    expect(json.token).toBeTruthy()
    expect(json.guest.name).toBeTruthy()
  })
})

describe('a note written in a space somebody shared', () => {
  test('counts against the owner of the space rather than the writer', async () => {
    writer = await invite(WRITER, 'write')

    const before = (await call(env, '/v1/usage', { token: owner })).json.used
    const theirs = (await call(env, '/v1/usage', { token: writer })).json.used
    await call(env, `/v1/spaces/${space}/notes`, {
      token: writer,
      body: { path: 'theirs.md', content: 'x'.repeat(500) },
    })

    const after = await call(env, '/v1/usage', { token: owner })
    const mine = await call(env, '/v1/usage', { token: writer })

    expect(after.json.used).toBe(before + 500)
    expect(mine.json.used).toBe(theirs)
  })

  test('is refused once the owner has no room for it, whoever is writing', async () => {
    writer = await invite(WRITER, 'write')
    env.db.exec(
      `insert into blobs (hash, user_id, size, type, created_at)
       values ('${'f'.repeat(64)}', (select id from users where email = '${OWNER}'),
               1073741824, 'image/png', 1)`,
    )

    const { status } = await call(env, `/v1/spaces/${space}/notes`, {
      token: writer,
      body: { path: 'theirs.md', content: 'more' },
    })

    expect(status).toBe(507)
  })
})

describe('the PDFs a shared space keeps', () => {
  function blobOf(email: string, hash: string) {
    env.db.exec(
      `insert into blobs (hash, user_id, size, type, created_at)
       values ('${hash}', (select id from users where email = '${email}'), 10, 'application/pdf', 1)`,
    )
  }

  function files(as: string, list: { path: string; hash: string }[]) {
    return call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token: as,
      body: { files: list },
    })
  }

  const theirs = { path: 'paper.pdf', hash: 'a'.repeat(64) }
  const mine = { path: 'notes.pdf', hash: 'b'.repeat(64) }

  test('are not dropped by a writer who does not hold their bytes', async () => {
    blobOf(OWNER, theirs.hash)
    await files(owner, [theirs])

    writer = await invite(WRITER, 'write')
    blobOf(WRITER, mine.hash)

    const { json } = await files(writer, [theirs, mine])

    expect(json.files).toEqual([theirs, mine])
    expect(json.missing).toEqual([])
  })

  test('still leave out one nobody in the space is keeping', async () => {
    writer = await invite(WRITER, 'write')
    const { json } = await files(writer, [mine])

    expect(json.files).toEqual([])
    expect(json.missing).toEqual([mine.hash])
  })
})

describe('recently deleted in a shared space', () => {
  test('stays the owner’s, whoever deleted the note', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token: writer })

    expect((await call(env, '/v1/trash', { token: writer })).json.notes).toEqual([])
    expect(
      (await call(env, '/v1/trash', { token: owner })).json.notes.map((one) => one.path),
    ).toEqual(['plan.md'])
  })

  test('is not a way into somebody else’s notes', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token: writer })

    for (const [path, method] of [
      [`/v1/trash/notes/${note}/restore`, 'POST'],
      [`/v1/trash/notes/${note}`, 'DELETE'],
    ] as const) {
      expect((await call(env, path, { method, token: writer })).status, path).toBe(404)
    }

    await call(env, '/v1/trash', { method: 'DELETE', token: writer })
    expect((await call(env, '/v1/trash', { token: owner })).json.notes).toHaveLength(1)

    const back = await call(env, `/v1/trash/notes/${note}/restore`, {
      method: 'POST',
      token: owner,
    })
    expect(back.status).toBe(200)
  })

  test('keeps the space itself the owner’s to restore', async () => {
    writer = await invite(WRITER, 'write')
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token: owner })

    expect((await call(env, '/v1/trash', { token: writer })).json.spaces).toEqual([])
  })
})

describe('the connector in a shared space', () => {
  async function connector(session: string): Promise<string> {
    const { json } = await call(env, '/v1/mcp/token', { token: session, body: { readOnly: false } })
    return json.token
  }

  function tool(session: string, name: string, args: Record<string, unknown>) {
    return call<{ result: { content: { text: string }[] } }>(env, '/mcp', {
      token: session,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
  }

  test('lists a space somebody shared alongside the account’s own', async () => {
    writer = await invite(WRITER, 'write')
    const said = await tool(await connector(writer), 'list_spaces', {})

    expect(said.json.result.content[0]?.text).toBe(
      `Notes\n<untrusted source="spaces shared with you">\n${SHARED}\n</untrusted>`,
    )
  })

  test('reads a note in it', async () => {
    reader = await invite(READER, 'read')
    const said = await tool(await connector(reader), 'read_note', {
      space: SHARED,
      path: 'plan.md',
    })

    expect(said.json.result.content[0]?.text).toBe(
      `<untrusted source="shared space ${SHARED}">\n# Plan\n\n</untrusted>`,
    )
  })

  test('writes in one that was shared to write in', async () => {
    writer = await invite(WRITER, 'write')
    const said = await tool(await connector(writer), 'write_note', {
      space: SHARED,
      path: 'plan.md',
      content: 'rewritten',
    })

    expect(said.json.result.content[0]?.text).toBe('Saved plan.md.')
  })

  test('refuses to write in one that was shared to read', async () => {
    reader = await invite(READER, 'read')
    const said = await tool(await connector(reader), 'write_note', {
      space: SHARED,
      path: 'plan.md',
      content: 'rewritten',
    })

    expect(said.json.result.content[0]?.text).toBe(
      `${SHARED} was shared with you to read, not to write.`,
    )
  })

  test('cannot see a space nobody shared', async () => {
    const said = await tool(await connector(stranger), 'list_spaces', {})
    expect(said.json.result.content[0]?.text).toBe('Notes')
  })
})
