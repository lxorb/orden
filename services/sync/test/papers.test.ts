import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

/** The paper a page note holds, kept by the note's id (#551): what a second device and
 *  somebody the note was shared with on its own open the note's pages on. */

const OWNER = 'owner@example.com'

let env: TestEnv
let owner: string
let space: string
let pages: string

/** A PDF's bytes and the hash they are named by. Plain text, so the answer reads back
 *  as the same string. */
function paper(words = 'a lecture') {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n${words}\n%%EOF\n`)
  return {
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
    text: new TextDecoder().decode(bytes),
  }
}

function upload(one: ReturnType<typeof paper>, token = owner) {
  return call(env, `/v1/blobs/${one.hash}`, {
    method: 'PUT',
    token,
    raw: one.bytes,
    headers: { 'content-type': 'application/pdf' },
  })
}

function hold(id: string, hash: string, token = owner) {
  return call(env, `/v1/notes/${id}/paper`, { method: 'PUT', token, body: { hash } })
}

function note(path: string, content = '{}') {
  return call(env, `/v1/spaces/${space}/notes`, { token: owner, body: { path, content } })
}

/** An open link to one file, followed by somebody with no account: their token. */
async function guestOf(item: string): Promise<string> {
  const { json } = await call<{ link?: { url: string } }>(
    env,
    `/v1/spaces/${space}/share/link?item=${item}`,
    { method: 'PUT', token: owner, body: { role: 'write', mode: 'open' } },
  )
  const found = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')
  if (!found?.[1]) throw new Error('no link was made')
  const joined = await call(env, `/v1/join/${found[1]}`, { method: 'POST' })
  return joined.json.token
}

beforeEach(async () => {
  env = testEnv()
  owner = await signIn(env, OWNER)
  space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Lectures' } })).json.space
    .id
  pages = (await note('Lecture.pages')).json.note.id
})

afterEach(() => env.close())

describe('the paper a page note holds', () => {
  test('is the bytes it was given, for the account that holds the note', async () => {
    const one = paper()
    expect((await upload(one)).status).toBe(201)
    expect((await hold(pages, one.hash)).status).toBe(200)

    const got = await call(env, `/v1/notes/${pages}/paper`, { token: owner })
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('application/pdf')
    expect(got.text).toBe(one.text)
  })

  test('reaches somebody the note was shared with on its own', async () => {
    const one = paper()
    await upload(one)
    await hold(pages, one.hash)

    const guest = await guestOf(pages)
    const got = await call(env, `/v1/notes/${pages}/paper`, { token: guest })
    expect(got.status).toBe(200)
    expect(got.text).toBe(one.text)
  })

  test('and nobody else', async () => {
    const one = paper()
    await upload(one)
    await hold(pages, one.hash)

    const stranger = await signIn(env, 'stranger@example.com')
    expect((await call(env, `/v1/notes/${pages}/paper`, { token: stranger })).status).toBe(404)
    expect((await call(env, `/v1/notes/${pages}/paper`)).status).toBe(401)
  })

  test('is nothing for a page note that holds none', async () => {
    expect((await call(env, `/v1/notes/${pages}/paper`, { token: owner })).status).toBe(404)
  })

  test('follows the note through a rename', async () => {
    const one = paper()
    await upload(one)
    await hold(pages, one.hash)
    await call(env, `/v1/notes/${pages}`, {
      method: 'PUT',
      token: owner,
      body: { path: 'Week 1/Lecture.pages', content: '{}' },
    })

    expect((await call(env, `/v1/notes/${pages}/paper`, { token: owner })).text).toBe(one.text)
  })

  test('cannot name bytes nobody here uploaded', async () => {
    expect((await hold(pages, paper('never sent').hash)).status).toBe(409)
  })

  test('is a page note’s alone', async () => {
    const one = paper()
    await upload(one)
    const words = (await note('plan.md', '# Plan\n')).json.note.id
    expect((await hold(words, one.hash)).status).toBe(400)
  })

  test('is not set by somebody handed the one note', async () => {
    const guest = await guestOf(pages)
    const one = paper()
    await upload(one)
    expect((await hold(pages, one.hash, guest)).status).toBe(403)
  })
})
