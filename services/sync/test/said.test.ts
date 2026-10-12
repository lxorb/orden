import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { sha256 } from '../src/crypto'
import { MOST_ASKED } from '../src/notes'
import { call, signIn, type TestEnv, testEnv } from './harness'

/** What a device signing back in asks about the copies it holds: whether each is words
 *  its note once said, and what the note said at the moment both sides last agreed. */

interface Said {
  said?: string[]
  content?: string
  error?: string
  note?: { id: string; version: number }
  space?: { id: string }
}

let env: TestEnv
let token: string
let note: string

/** Five minutes apart, the most often the account keeps one. */
function aged(): void {
  env.db.exec('update note_versions set at = at - 600000')
}

async function writes(content: string, baseVersion: number) {
  await call(env, `/v1/notes/${note}`, { method: 'PUT', token, body: { content, baseVersion } })
  aged()
}

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  const made = await call<Said>(env, '/v1/spaces', { token, body: { name: 'Work' } })
  const wrote = await call<Said>(env, `/v1/spaces/${made.json.space?.id ?? ''}/notes`, {
    token,
    body: { path: 'plan.md', content: 'one' },
  })
  note = wrote.json.note?.id ?? ''
  aged()
  await writes('two', 1)
  await writes('three', 2)
})

afterEach(() => env.close())

describe('which copies a note once said', () => {
  test('names an older version and the words it says now', async () => {
    const asked = await call<Said>(env, '/v1/notes/said', {
      token,
      body: {
        notes: [
          { id: note, hash: await sha256('one') },
          { id: note, hash: await sha256('three') },
        ],
      },
    })

    expect(asked.status).toBe(200)
    expect(asked.json.said).toEqual([note, note])
  })

  test('leaves out words it never said', async () => {
    const asked = await call<Said>(env, '/v1/notes/said', {
      token,
      body: { notes: [{ id: note, hash: await sha256('never') }] },
    })

    expect(asked.json.said).toEqual([])
  })

  test('says nothing about a note somebody else holds', async () => {
    const stranger = await signIn(env, 'c@d.dev')
    const asked = await call<Said>(env, '/v1/notes/said', {
      token: stranger,
      body: { notes: [{ id: note, hash: await sha256('one') }] },
    })

    expect(asked.json.said).toEqual([])
  })

  test('refuses a list past the most one question names', async () => {
    const notes = Array.from({ length: MOST_ASKED + 1 }, () => ({ id: note, hash: 'x' }))
    const asked = await call<Said>(env, '/v1/notes/said', { token, body: { notes } })

    expect(asked.status).toBe(400)
  })

  test('refuses what is not a list of notes', async () => {
    const asked = await call<Said>(env, '/v1/notes/said', { token, body: { notes: [{ id: 1 }] } })

    expect(asked.status).toBe(400)
  })
})

describe('what a note said at a hash', () => {
  test('is the words of that version', async () => {
    const asked = await call<Said>(env, `/v1/notes/${note}/said/${await sha256('two')}`, { token })

    expect(asked.status).toBe(200)
    expect(asked.json.content).toBe('two')
  })

  test('is nothing for words it never said', async () => {
    const asked = await call<Said>(env, `/v1/notes/${note}/said/${await sha256('nope')}`, {
      token,
    })

    expect(asked.status).toBe(404)
  })

  test('is nothing to somebody who cannot reach the note', async () => {
    const stranger = await signIn(env, 'c@d.dev')
    const asked = await call<Said>(env, `/v1/notes/${note}/said/${await sha256('two')}`, {
      token: stranger,
    })

    expect(asked.status).toBe(404)
  })
})
