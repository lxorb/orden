import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Answer, call, mail, signIn, type TestEnv, testEnv } from './harness'

interface Addresses {
  email: string
  second: string | null
  error?: string
}

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'ann@example.com')
})

afterEach(() => env.close())

function codeIn(said: string): string {
  const found = /(\d{3}) (\d{3})/.exec(said)
  if (!found) throw new Error(`no code was sent:\n${said}`)
  return `${found[1]}${found[2]}`
}

async function confirmed(
  email: string,
  as: 'primary' | 'second',
  by = token,
): Promise<{ answer: Answer<Addresses>; mailed: string }> {
  const said = await mail(() =>
    call(env, '/v1/account/addresses/code', { token: by, body: { email } }),
  )
  const got: Answer<Addresses>[] = []
  const mailed = await mail(async () => {
    got.push(
      await call<Addresses>(env, '/v1/account/addresses', {
        token: by,
        body: { email, code: codeIn(said), as },
      }),
    )
  })
  const [answer] = got
  if (!answer) throw new Error('no answer')
  return { answer, mailed }
}

const idOf = async (as: string): Promise<string> =>
  (await call(env, '/v1/me', { token: as })).json.user.id

const memberRows = () =>
  env.db.prepare('select email from space_members order by email').all() as { email: string }[]

describe('a second address (#2029)', () => {
  test('is added once its code is given, and signs in to the same account', async () => {
    const { answer } = await confirmed('ann@work.example', 'second')
    expect(answer.json).toEqual({ email: 'ann@example.com', second: 'ann@work.example' })

    const again = await signIn(env, 'ann@work.example')
    expect(await idOf(again)).toBe(await idOf(token))
    expect(env.db.prepare('select count(*) as n from users').get()).toEqual({ n: 1 })
  })

  test('is refused with a wrong code, and nothing changes', async () => {
    await mail(() =>
      call(env, '/v1/account/addresses/code', { token, body: { email: 'ann@work.example' } }),
    )
    const wrong = await call<Addresses>(env, '/v1/account/addresses', {
      token,
      body: { email: 'ann@work.example', code: '000000', as: 'second' },
    })
    expect(wrong.status).toBe(400)
    expect((await call<Addresses>(env, '/v1/account/addresses', { token })).json.second).toBeNull()
  })

  test('becomes the primary, and the old one becomes the second', async () => {
    await confirmed('ann@work.example', 'second')
    const swapped: Answer<Addresses>[] = []
    const mailed = await mail(async () => {
      swapped.push(
        await call<Addresses>(env, '/v1/account/addresses/second/primary', {
          token,
          method: 'POST',
        }),
      )
    })
    expect(mailed).toContain('Your Orden address was changed')
    expect(swapped[0]?.json).toEqual({ email: 'ann@work.example', second: 'ann@example.com' })
    expect(await idOf(await signIn(env, 'ann@example.com'))).toBe(await idOf(token))
  })

  test('is taken away, and then signs in to an account of its own', async () => {
    await confirmed('ann@work.example', 'second')
    const removed = await call<Addresses>(env, '/v1/account/addresses/second', {
      token,
      method: 'DELETE',
    })
    expect(removed.json.second).toBeNull()
    expect(await idOf(await signIn(env, 'ann@work.example'))).not.toBe(await idOf(token))
  })

  test('that belongs to another account is refused, before the code and after it', async () => {
    const bob = await signIn(env, 'bob@example.com')
    const asked = await call<Addresses>(env, '/v1/account/addresses/code', {
      token,
      body: { email: 'bob@example.com' },
    })
    expect(asked.status).toBe(409)

    const said = await mail(() =>
      call(env, '/v1/account/addresses/code', { token, body: { email: 'shared@example.com' } }),
    )
    env.db
      .prepare('insert into user_addresses (email, user_id, created_at) values (?, ?, 1)')
      .run('shared@example.com', await idOf(bob))
    const late = await call<Addresses>(env, '/v1/account/addresses', {
      token,
      body: { email: 'shared@example.com', code: codeIn(said), as: 'second' },
    })
    expect(late.status).toBe(409)
    expect(late.json.error).toBe('that address belongs to another account')
  })

  test('an invite sent to it, before or after it was added, reaches the account', async () => {
    const bob = await signIn(env, 'bob@example.com')
    const space = (await call(env, '/v1/spaces', { token: bob, body: { name: 'Team' } })).json.space
      .id
    const other = (await call(env, '/v1/spaces', { token: bob, body: { name: 'Other' } })).json
      .space.id
    const invite = (id: string) =>
      mail(() =>
        call(env, `/v1/spaces/${id}/share/invite`, {
          token: bob,
          body: { email: 'ann@work.example', role: 'write' },
        }),
      )

    await invite(space)
    expect(memberRows()).toEqual([{ email: 'ann@work.example' }])

    await confirmed('ann@work.example', 'second')
    expect(memberRows()).toEqual([{ email: 'ann@example.com' }])

    await invite(other)
    expect(memberRows()).toEqual([{ email: 'ann@example.com' }, { email: 'ann@example.com' }])
  })
})

describe('changing the address (#2029)', () => {
  test('takes the new one once confirmed, moves what was shared, and tells the old one how to undo', async () => {
    const bob = await signIn(env, 'bob@example.com')
    const space = (await call(env, '/v1/spaces', { token: bob, body: { name: 'Team' } })).json.space
      .id
    await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token: bob,
        body: { email: 'ann@example.com', role: 'write' },
      }),
    )

    const { answer, mailed } = await confirmed('ann@new.example', 'primary')
    expect(answer.json).toEqual({ email: 'ann@new.example', second: null })
    expect(memberRows()).toEqual([{ email: 'ann@new.example' }])
    expect(mailed).toContain('ann@example.com')
    expect(mailed).toContain('Your Orden address was changed')

    const undo = /\/v1\/account\/undo\/([a-f0-9]+)/.exec(mailed)?.[1]
    expect(undo).toBeDefined()
    expect((await call(env, `/v1/account/undo/${undo}`)).status).toBe(200)
    expect((await call<Addresses>(env, '/v1/account/addresses', { token })).json.email).toBe(
      'ann@new.example',
    )

    const undone = await call(env, `/v1/account/undo/${undo}`, { method: 'POST' })
    expect(undone.status).toBe(200)
    expect(memberRows()).toEqual([{ email: 'ann@example.com' }])
    expect((await call(env, '/v1/me', { token })).status).toBe(401)
    expect((await call(env, `/v1/account/undo/${undo}`, { method: 'POST' })).status).toBe(404)
  })

  test('to an address another account holds is refused, and the account keeps its own', async () => {
    await signIn(env, 'bob@example.com')
    const asked = await call<Addresses>(env, '/v1/account/addresses/code', {
      token,
      body: { email: 'bob@example.com' },
    })
    expect(asked.status).toBe(409)
    expect((await call<Addresses>(env, '/v1/account/addresses', { token })).json.email).toBe(
      'ann@example.com',
    )
  })

  test('is refused by the database itself where two accounts race for one address', () => {
    const insert = (id: string, email: string) =>
      env.db
        .prepare('insert into user_addresses (email, user_id, created_at) values (?, ?, 1)')
        .run(email, id)
    expect(() => insert('somebody', 'ann@example.com')).toThrow(/address taken/)
    insert('somebody', 'free@example.com')
    expect(() =>
      env.db
        .prepare('insert into users (id, email, created_at) values (?, ?, 1)')
        .run('another', 'free@example.com'),
    ).toThrow(/address taken/)
  })
})
