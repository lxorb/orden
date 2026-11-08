import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { subprotocol } from '@orden/rooms'
import { spacesFor } from '../src/mcp/tools'
import { MOST_ITEMS } from '../src/spaces/space'
import { purgeExpired } from '../src/trash'
import { call, mail, signIn, testEnv, type JoinView, type ShareView, type TestEnv } from './harness'
import { doorway } from './room'

const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const STRANGER = 'nobody@example.com'

const SHARED_NOTE = 'plans/meeting.md'
const OTHER_NOTE = 'plans/private.md'
const CANVAS = 'plans/board.canvas'

interface SharedView {
  shared: {
    id: string
    path: string
    name: string
    role: string
    updatedAt: number
    owner: { name: string }
    space: { id: string; name: string }
  }[]
  error: string
}

let env: TestEnv
let owner: string
let space: string
let note: string
let other: string
let canvas: string

async function makeNote(path: string, content: string): Promise<string> {
  const made = await call(env, `/v1/spaces/${space}/notes`, {
    token: owner,
    body: { path, content },
  })
  return made.json.note.id
}

function itemView(item = note, as = owner) {
  return call<ShareView>(env, `/v1/spaces/${space}/share?item=${item}`, { token: as })
}

async function inviteLink(email: string, role: 'write' | 'read', item = note): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite?item=${item}`, {
      token: owner,
      body: { email, role },
    }),
  )

  const found = /\/join\/([a-f0-9]+)/.exec(sent)
  if (!found?.[1]) throw new Error(`no invitation was sent:\n${sent}`)
  return found[1]
}

async function given(email: string, role: 'write' | 'read', item = note): Promise<string> {
  const link = await inviteLink(email, role, item)
  const token = await signIn(env, email)
  await call(env, `/v1/join/${link}`, { method: 'POST', token })
  return token
}

async function itemLink(
  role: 'write' | 'read',
  mode: 'open' | 'approval',
  item = note,
): Promise<string> {
  const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link?item=${item}`, {
    method: 'PUT',
    token: owner,
    body: { role, mode },
  })

  const found = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')
  if (!found?.[1]) throw new Error('no link was made')
  return found[1]
}

beforeEach(async () => {
  env = testEnv()
  owner = await signIn(env, OWNER)
  await call(env, '/v1/me', { method: 'PATCH', token: owner, body: { name: 'Emil' } })

  const made = await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })
  space = made.json.space.id

  note = await makeNote(SHARED_NOTE, '# The meeting\n')
  other = await makeNote(OTHER_NOTE, '# Not yours\n')
  canvas = await makeNote(CANVAS, '{"nodes":[]}')
})

afterEach(() => env.close())

describe('a share about one file', () => {
  test('is a membership like any other, and says which file it is about', async () => {
    await given(FRIEND, 'write')

    const { json } = await itemView()
    expect(json.item).toEqual({ id: note, path: SHARED_NOTE })
    expect(json.members.map((one) => [one.email, one.role, one.pending])).toEqual([
      [FRIEND, 'write', false],
    ])
  })

  test('and leaves the space itself shared with nobody', async () => {
    await given(FRIEND, 'write')

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.item).toBeNull()
    expect(sheet.json.members).toEqual([])

    const listed = await call(env, '/v1/spaces', { token: owner })
    const mine = listed.json.spaces.find((one) => one.id === space)
    expect(mine?.shared).toBe(false)
    expect(mine?.sharedItems).toEqual([note])
  })

  test('names the file rather than the space in the mail it sends', async () => {
    const sent = await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite?item=${note}`, {
        token: owner,
        body: { email: FRIEND, role: 'read' },
      }),
    )

    expect(sent).toContain('Emil shared meeting with you')
    expect(sent).toContain('shared the note meeting')
    expect(sent).not.toContain('shared the space')
  })

  test('and is refused about a note that is not a live note of this space', async () => {
    const elsewhere = await call(env, '/v1/spaces', { token: owner, body: { name: 'Other' } })
    const theirs = await call(env, `/v1/spaces/${elsewhere.json.space.id}/notes`, {
      token: owner,
      body: { path: 'far.md', content: 'x' },
    })

    for (const item of [theirs.json.note.id, 'nonsense']) {
      const asked = await call(env, `/v1/spaces/${space}/share?item=${item}`, { token: owner })
      expect(asked.status, item).toBe(404)
    }

    await call(env, `/v1/notes/${other}`, { method: 'DELETE', token: owner })
    const deleted = await call(env, `/v1/spaces/${space}/share?item=${other}`, { token: owner })
    expect(deleted.status).toBe(404)
  })
})

describe('somebody who was handed one file', () => {
  let friend: string

  beforeEach(async () => {
    friend = await given(FRIEND, 'write')
  })

  test('reads it and writes in it', async () => {
    const read = await call(env, `/v1/notes/${note}`, { token: friend })
    expect(read.status).toBe(200)
    expect(read.json.content).toBe('# The meeting\n')

    const written = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: friend,
      body: { content: '# The meeting\n\nand a line', baseVersion: read.json.note.version },
    })
    expect(written.status).toBe(200)

    const held = await call(env, `/v1/notes/${note}`, { token: owner })
    expect(held.json.content).toBe('# The meeting\n\nand a line')
  })

  test('and cannot reach one thing about the space it came out of', async () => {
    const listed = await call(env, '/v1/spaces', { token: friend })
    expect(listed.json.spaces.some((one) => one.id === space)).toBe(false)

    for (const [method, path] of [
      ['GET', `/v1/spaces/${space}/changes`],
      ['GET', `/v1/spaces/${space}/share`],
      ['POST', `/v1/spaces/${space}/notes`],
      ['PUT', `/v1/spaces/${space}/bookmarks`],
      ['DELETE', `/v1/spaces/${space}/share/me`],
    ] as const) {
      const asked = await call(env, path, {
        method,
        token: friend,
        ...(method === 'GET' ? {} : { body: {} }),
      })
      expect(asked.status, path).toBe(404)
    }
  })

  test('and cannot reach the other files of it either', async () => {
    for (const id of [other, canvas]) {
      const asked = await call(env, `/v1/notes/${id}`, { token: friend })
      expect(asked.status, id).toBe(404)
    }
  })

  test('and cannot move it or take it away', async () => {
    const read = await call(env, `/v1/notes/${note}`, { token: friend })

    const moved = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: friend,
      body: { path: 'plans/renamed.md', content: 'x', baseVersion: read.json.note.version },
    })
    expect(moved.status).toBe(403)

    const gone = await call(env, `/v1/notes/${note}`, { method: 'DELETE', token: friend })
    expect(gone.status).toBe(403)

    const still = await call(env, `/v1/notes/${note}`, { token: owner })
    expect(still.json.note.path).toBe(SHARED_NOTE)
    expect(still.json.note.deleted).toBe(false)
  })

  test('and the connector does not list the space either', async () => {
    const who = (await call(env, '/v1/me', { token: friend })).json.user.id
    const listed = await spacesFor(env, who)

    expect(listed.map((one) => one.id)).not.toContain(space)
  })

  test('and finds it listed as one file with a name and an owner', async () => {
    const { json } = await call<SharedView>(env, '/v1/shared', { token: friend })

    expect(json.shared).toHaveLength(1)
    expect(json.shared[0]).toMatchObject({
      id: note,
      path: SHARED_NOTE,
      name: 'meeting',
      role: 'write',
      owner: { name: 'Emil' },
      space: { id: space, name: 'Plans' },
    })
  })

  test('and a reader is refused the write', async () => {
    const reader = await given('reader@example.com', 'read', canvas)

    const read = await call(env, `/v1/notes/${canvas}`, { token: reader })
    expect(read.status).toBe(200)

    const written = await call(env, `/v1/notes/${canvas}`, {
      method: 'PUT',
      token: reader,
      body: { content: '{"nodes":[1]}', baseVersion: read.json.note.version },
    })
    expect(written.status).toBe(403)
  })
})

describe('the room door', () => {
  test('opens the shared file to the person handed it, and no other file', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    owner = await signIn(env, OWNER)
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id
    note = await makeNote(SHARED_NOTE, '# The meeting\n')
    other = await makeNote(OTHER_NOTE, '# Not yours\n')

    const friend = await given(FRIEND, 'write')
    const reader = await given('reader@example.com', 'read')

    for (const [who, token, writes] of [
      ['writer', friend, 'yes'],
      ['reader', reader, 'no'],
    ] as const) {
      const answer = await call(env, `/rooms/${note}`, {
        headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
      })

      expect(answer.status, who).toBe(200)
      expect(door.asked.at(-1)?.get('x-orden-write'), who).toBe(writes)
      expect(door.asked.at(-1)?.get('x-orden-space'), who).toBe(space)
    }

    const refused = await call(env, `/rooms/${other}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(friend) },
    })
    expect(refused.status).toBe(404)
  })

  test('gives the stronger of a space role and a file role', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    owner = await signIn(env, OWNER)
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id
    note = await makeNote(SHARED_NOTE, '# The meeting\n')

    await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: FRIEND, role: 'read' },
    })
    const friend = await signIn(env, FRIEND)
    await call(env, `/v1/spaces/${space}/share/invite?item=${note}`, {
      token: owner,
      body: { email: FRIEND, role: 'write' },
    })

    const answer = await call(env, `/rooms/${note}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(friend) },
    })

    expect(answer.status).toBe(200)
    expect(door.asked.at(-1)?.get('x-orden-write')).toBe('yes')
  })
})

describe('a link to one file', () => {
  test('says what it is about before there is a session to have', async () => {
    const token = await itemLink('read', 'open')
    const { json } = await call<JoinView>(env, `/v1/join/${token}`)

    expect(json.space).toBe('Plans')
    expect(json.note).toBe('meeting')
    expect(json.role).toBe('read')
    expect(json.from).toBe('Emil')
  })

  test('hands out a guest who holds that file and nothing else', async () => {
    const token = await itemLink('write', 'open')
    const walked = await call(env, `/v1/join/${token}`, {
      method: 'POST',
      body: { device: 'Windows' },
    })

    expect(walked.status).toBe(200)
    expect(walked.json.space).toBeUndefined()
    const guest = walked.json.token

    const listed = await call<SharedView>(env, '/v1/shared', { token: guest })
    expect(listed.json.shared.map((one) => one.id)).toEqual([note])

    const spaces = await call(env, '/v1/spaces', { token: guest })
    expect(spaces.json.spaces).toEqual([])
    const refused = await call(env, `/v1/notes/${other}`, { token: guest })
    expect(refused.status).toBe(404)

    const read = await call(env, `/v1/notes/${note}`, { token: guest })
    expect(read.status).toBe(200)
    const written = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: guest,
      body: { content: 'from a guest', baseVersion: read.json.note.version },
    })
    expect(written.status).toBe(200)
  })

  test('and one that asks first waits on the owner, about that file', async () => {
    const token = await itemLink('read', 'approval')
    const asked = await call(env, `/v1/join/${token}`, { method: 'POST', body: { name: 'Ada' } })

    expect(asked.json.waiting).toBe(true)
    const guest = asked.json.token

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.requests).toEqual([])

    const onTheFile = await itemView()
    expect(onTheFile.json.requests.map((one) => one.name)).toEqual(['Ada'])

    const waiting = onTheFile.json.requests[0]?.guest ?? ''
    await call(env, `/v1/spaces/${space}/share/guests/${waiting}?item=${note}`, {
      method: 'POST',
      token: owner,
    })

    const again = await call(env, `/v1/join/${token}`, { method: 'POST', token: guest })
    expect(again.json.waiting).toBeUndefined()
    const listed = await call<SharedView>(env, '/v1/shared', { token: guest })
    expect(listed.json.shared.map((one) => one.id)).toEqual([note])
  })

  test('and a guest who signs in keeps the file as the account', async () => {
    const token = await itemLink('write', 'open')
    const walked = await call(env, `/v1/join/${token}`, { method: 'POST', body: {} })

    const account = await signIn(env, FRIEND, walked.json.token)
    const listed = await call<SharedView>(env, '/v1/shared', { token: account })

    expect(listed.json.shared.map((one) => one.id)).toEqual([note])
  })
})

describe('revoking a share about one file', () => {
  test('makes the file private again at once', async () => {
    const friend = await given(FRIEND, 'write')
    await call(env, `/v1/spaces/${space}/share/members/${FRIEND}?item=${note}`, {
      method: 'DELETE',
      token: owner,
    })

    const refused = await call(env, `/v1/notes/${note}`, { token: friend })
    expect(refused.status).toBe(404)

    const listed = await call<SharedView>(env, '/v1/shared', { token: friend })
    expect(listed.json.shared).toEqual([])

    const spaces = await call(env, '/v1/spaces', { token: owner })
    expect(spaces.json.spaces.find((one) => one.id === space)?.sharedItems).toEqual([])
  })

  test('and revoking the link stops it opening anything', async () => {
    const token = await itemLink('write', 'open')
    await call(env, `/v1/spaces/${space}/share/link?item=${note}`, {
      method: 'DELETE',
      token: owner,
    })

    const walked = await call(env, `/v1/join/${token}`, { method: 'POST', body: {} })
    expect(walked.status).toBe(404)
  })

  test('and the person handed it can let themselves out', async () => {
    const friend = await given(FRIEND, 'write')

    const left = await call(env, `/v1/shared/${note}`, { method: 'DELETE', token: friend })
    expect(left.status).toBe(200)

    const listed = await call<SharedView>(env, '/v1/shared', { token: friend })
    expect(listed.json.shared).toEqual([])
    const refused = await call(env, `/v1/notes/${note}`, { token: friend })
    expect(refused.status).toBe(404)
  })

  test('and it answers the same for a file nobody handed them', async () => {
    const stranger = await signIn(env, STRANGER)

    const real = await call(env, `/v1/shared/${note}`, { method: 'DELETE', token: stranger })
    const madeUp = await call(env, '/v1/shared/not-a-note-at-all', {
      method: 'DELETE',
      token: stranger,
    })

    expect(real.status).toBe(200)
    expect(madeUp.status).toBe(real.status)
    expect(madeUp.json).toEqual(real.json)

    const friend = await given(FRIEND, 'write')
    const listed = await call<SharedView>(env, '/v1/shared', { token: friend })
    expect(listed.json.shared.map((one) => one.id)).toEqual([note])
  })

  test('and a file purged from Recently deleted takes its shares with it', async () => {
    await given(FRIEND, 'write')
    await itemLink('read', 'open')

    await call(env, `/v1/notes/${note}`, { method: 'DELETE', token: owner })
    env.db.exec(`update notes set deleted_at = 1 where id = '${note}'`)
    await purgeExpired(env, Date.now())

    const held = env.db
      .prepare(
        `select (select count(*) from space_members where item = ?1)
              + (select count(*) from space_links where item = ?1) as rows`,
      )
      .get(note) as { rows: number }

    expect(held.rows).toBe(0)
  })
})

describe('the ceilings', () => {
  test('count a write against whoever owns the space', async () => {
    const friend = await given(FRIEND, 'write')
    const read = await call(env, `/v1/notes/${note}`, { token: friend })

    env.db.exec(`update notes set size = 3221225472 where id = '${other}'`)

    const written = await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token: friend,
      body: {
        content: '# The meeting\n\nand a much longer line than before',
        baseVersion: read.json.note.version,
      },
    })

    expect(written.status).toBe(507)
  })

  test('and bound how many files one space shares on their own', { timeout: 120_000 }, async () => {
    for (let made = 0; made < MOST_ITEMS; made++) {
      const id = made === 0 ? note : await makeNote(`plans/note-${made}.md`, 'x')
      await call(env, `/v1/spaces/${space}/share/link?item=${id}`, {
        method: 'PUT',
        token: owner,
        body: { role: 'read', mode: 'open' },
      })
    }

    const oneMore = await call(env, `/v1/spaces/${space}/share/link?item=${canvas}`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    expect(oneMore.status).toBe(409)

    const again = await call(env, `/v1/spaces/${space}/share/link?item=${note}`, {
      method: 'PUT',
      token: owner,
      body: { role: 'write', mode: 'approval' },
    })
    expect(again.status).toBe(200)
  })

  test('and hold that bound when another file is shared at the same moment', async () => {
    const holdItems = (many: number) => {
      const add = env.db.prepare(
        `insert into space_links (space_id, item, token, role, mode, created_at)
         values (?, ?, ?, 'read', 'open', 1)`,
      )
      for (let at = 0; at < many; at++) add.run(space, `held-${at}`, `token-${at}`)
    }
    const items = () =>
      (
        env.db
          .prepare(
            `select count(*) as n from (select item from space_links where space_id = ?1
              union select item from space_members where space_id = ?1 and item <> '')`,
          )
          .get(space) as { n: number }
      ).n
    holdItems(MOST_ITEMS - 1)
    const quicker = (sql: RegExp) =>
      env.justBefore(sql, () => {
        env.db
          .prepare(
            `insert into space_links (space_id, item, token, role, mode, created_at)
             values (?, 'quicker', 'quicker-token', 'read', 'open', 1)`,
          )
          .run(space)
      })

    quicker(/insert into space_links/)
    const linked = await call(env, `/v1/spaces/${space}/share/link?item=${note}`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    expect(linked.status).toBe(409)
    expect(items()).toBe(MOST_ITEMS)

    env.db.prepare("delete from space_links where item = 'quicker'").run()
    quicker(/insert into space_members/)
    const invited = await call(env, `/v1/spaces/${space}/share/invite?item=${note}`, {
      token: owner,
      body: { email: FRIEND, role: 'read' },
    })
    expect(invited.status).toBe(409)
    expect(invited.json.error).toBe('that is as many notes as one space shares on their own')
    expect(items()).toBe(MOST_ITEMS)
  })

  test('and only the owner shares one of a space files', async () => {
    await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: FRIEND, role: 'write' },
    })
    const writer = await signIn(env, FRIEND)

    const asked = await call(env, `/v1/spaces/${space}/share?item=${note}`, { token: writer })
    expect(asked.status).toBe(403)

    const tried = await call(env, `/v1/spaces/${space}/share/invite?item=${note}`, {
      token: writer,
      body: { email: STRANGER, role: 'read' },
    })
    expect(tried.status).toBe(403)
  })
})
