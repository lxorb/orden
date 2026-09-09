/** The ceilings: how much mail one machine can cause, how many people the
 *  service writes to in a day, and how often an owner hears that somebody is
 *  waiting.
 *
 *  Every gate here is about the service rather than about one account, so each
 *  case is driven the way the outside drives it: a request with a
 *  `CF-Connecting-IP` header, or the rows a day of sending would have left. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, mail, signIn, testEnv, type ShareView, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => env.close())

/** Asking for a sign-in code, from a machine or from nowhere in particular. */
function askForACode(email: string, machine?: string) {
  return call(env, '/v1/auth/code', {
    body: { email },
    ...(machine ? { headers: { 'cf-connecting-ip': machine } } : {}),
  })
}

/** Which day the ceiling counts in, worked out the way limits.ts works it out. */
function today(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000))
}

/** A day's worth of sending already done, as the rows it would have left. */
function alreadyMailed(many: number): void {
  const insert = env.db.prepare('insert into mailed_days (day, email) values (?, ?)')
  for (let at = 0; at < many; at++) insert.run(today(), `already-${at}@example.com`)
}

function countedIn(scope: string): number {
  const row = env.db.prepare('select count(*) as held from limits where scope = ?').get(scope) as {
    held: number
  }
  return row.held
}

describe('mail from one machine', () => {
  test('stops at a number of messages an hour', async () => {
    for (let at = 0; at < 20; at++) {
      expect((await askForACode(`one-${at}@example.com`, '203.0.113.7')).status).toBe(200)
    }

    const refused = await askForACode('one-more@example.com', '203.0.113.7')
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too many messages from here - try again later')
  })

  test('counts the machine and not the address', async () => {
    for (let at = 0; at < 20; at++) await askForACode(`one-${at}@example.com`, '203.0.113.7')

    // Somebody else, somewhere else, is not held to what that machine spent.
    expect((await askForACode('elsewhere@example.com', '198.51.100.4')).status).toBe(200)
  })

  test('does not hold a resend against it, since no message goes out', async () => {
    await askForACode('same@example.com', '203.0.113.7')
    for (let at = 0; at < 30; at++) await askForACode('same@example.com', '203.0.113.7')

    // The address keeps its own gap, and the machine spent one message.
    expect((await askForACode('another@example.com', '203.0.113.7')).status).toBe(200)
  })

  test('is not counted at all where there is no machine to count', async () => {
    for (let at = 0; at < 25; at++) {
      expect((await askForACode(`nowhere-${at}@example.com`)).status).toBe(200)
    }
  })

  test('keeps one row per machine, cleared once its window has run out', async () => {
    await askForACode('one@example.com', '203.0.113.7')
    await askForACode('two@example.com', '203.0.113.7')
    expect(countedIn('mail')).toBe(1)

    env.db.prepare('update limits set until = ? where scope = ?').run(Date.now() - 1, 'mail')
    await askForACode('three@example.com', '198.51.100.4')

    expect(countedIn('mail')).toBe(1)
  })
})

describe('the people the service writes to in a day', () => {
  test('stops at a number of them', async () => {
    alreadyMailed(500)

    const refused = await askForACode('new@example.com', '203.0.113.7')
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too much mail today - try again tomorrow')
  })

  test('still writes to somebody it has written to today', async () => {
    alreadyMailed(500)
    env.db.prepare('insert into mailed_days (day, email) values (?, ?)').run(today(), 'a@b.dev')

    // An address already in today's set is not one more person to write to.
    const sent = await mail(() => askForACode('a@b.dev', '203.0.113.7'))
    expect(sent).toMatch(/\d{3} \d{3}/)
  })

  test('forgets yesterday as today arrives', async () => {
    const insert = env.db.prepare('insert into mailed_days (day, email) values (?, ?)')
    for (let at = 0; at < 600; at++) insert.run(today() - 1, `yesterday-${at}@example.com`)

    expect((await askForACode('today@example.com', '203.0.113.7')).status).toBe(200)

    const left = env.db.prepare('select count(*) as held from mailed_days').get() as {
      held: number
    }
    expect(left.held).toBe(1)
  })

  test('holds an invitation to the same ceiling, before it writes anything', async () => {
    const owner = await signIn(env, 'owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json
      .space.id

    alreadyMailed(500)

    const refused = await call(env, `/v1/spaces/${space}/share/invite`, {
      token: owner,
      body: { email: 'guest@example.com', role: 'write' },
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })

    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('too much mail today - try again tomorrow')

    // Nothing was written, so the sheet does not show somebody the owner was
    // told could not be reached.
    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.members).toEqual([])
  })
})

describe('telling an owner that somebody is waiting', () => {
  let owner: string
  let space: string
  let link: string

  beforeEach(async () => {
    owner = await signIn(env, 'owner@example.com')
    space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space.id

    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'approval' },
    })

    link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
    expect(link).toBeTruthy()
  })

  /** Somebody following the link that asks first, with no session at all. */
  function knock(name: string) {
    return call(env, `/v1/join/${link}`, { method: 'POST', body: { name, device: 'Windows' } })
  }

  test('happens once an hour however many people knock', async () => {
    const sent = await mail(async () => {
      for (let at = 0; at < 5; at++) await knock(`Someone ${at}`)
    })

    expect(sent.match(/would like to join/g)).toHaveLength(1)
  })

  test('and every one of them is still waiting on the owner', async () => {
    await mail(async () => {
      for (let at = 0; at < 5; at++) expect((await knock(`Someone ${at}`)).json.waiting).toBe(true)
    })

    const sheet = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token: owner })
    expect(sheet.json.requests).toHaveLength(5)
  })

  test('again once the hour has passed', async () => {
    await mail(() => knock('First'))

    // Both waits are moved on: the hour this ceiling keeps, and the thirty
    // seconds the owner's own address keeps between any two messages.
    env.db.prepare('update limits set until = ? where scope = ?').run(Date.now() - 1, 'waiting')
    env.db.prepare('delete from mailed').run()

    const sent = await mail(() => knock('Second'))
    expect(sent).toContain('would like to join')
  })
})
