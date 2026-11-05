/** What the account reads off a space's notes for a browser that keeps only some of
 *  their words (#1126): each note's scan, and a search over the rest, through their
 *  routes and against the words the account keeps. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { indexed } from '@orden/scan/indexed'
import { parseQuery } from '@orden/scan/search/query'
import { indexAnswerOf, searchAnswerOf, type SearchRequest } from '@orden/scan/wire'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { invited, live } from './sync2'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  live(env)
  token = await signIn(env, 'reading@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Reading' } })).json.space.id
})

afterEach(() => env.close())

async function made(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  if (answer.status !== 201) throw new Error(`${path}: ${answer.text}`)
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
  return answer.json.note.id
}

async function index(ids: unknown, as = token) {
  return await call(env, `/v2/spaces/${space}/index`, { token: as, body: { ids } })
}

async function search(request: Omit<SearchRequest, 'query' | 'terms'> & { q: string }, as = token) {
  const { q, ...rest } = request
  return await call(env, `/v2/spaces/${space}/search`, {
    token: as,
    body: { query: parseQuery(q), terms: [], ...rest },
  })
}

const NOTE = `---
status: draft
---
# Plans

See [[Ideas]] and #work.

- [ ] Write the plan
`

describe('the index', () => {
  test("answers a note's scan as the browser makes it, with the rows it carries", async () => {
    const id = await made('Projects/Plans.md', NOTE)
    const answer = await index([id])
    expect(answer.status).toBe(200)

    const items = indexAnswerOf(answer.json)
    const row = env.db.prepare('select * from notes where id = ?').get(id) as {
      doc_seq: number | null
      seq: number
      updated_at: number
    }
    const stamp = { size: NOTE.length, mtime: row.updated_at, ctime: row.updated_at }
    expect(items).toEqual([
      { id, docSeq: row.doc_seq ?? row.seq, scan: indexed('Projects/Plans.md', NOTE, stamp) },
    ])
    const scan = items?.[0] && 'scan' in items[0] ? items[0].scan : null
    expect(scan?.links.map((one) => one.target)).toEqual(['Ideas'])
    expect(scan?.tags).toEqual(['work'])
    expect(scan?.front).toBe('status: draft')
    expect(scan?.tasks?.map((one) => one.text)).toEqual(['Write the plan'])
  })

  test("a plane's marks and a website's", async () => {
    const plane = await made(
      'Board.canvas',
      JSON.stringify({
        nodes: [{ id: 'a', type: 'file', file: 'Plans.md', x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
      }),
    )
    const site = await made('Svelte.url', '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n')
    const items = indexAnswerOf((await index([plane, site])).json) ?? []
    const scans = new Map(items.map((one) => [one.id, 'scan' in one ? one.scan : null]))
    expect(scans.get(plane)?.links.map((one) => one.target)).toEqual(['Plans.md'])
    expect(scans.get(site)?.address).toBe('https://svelte.dev/')
  })

  test('a note gone, or never in this space, is gone', async () => {
    const id = await made('Gone.md', '# Gone\n')
    await call(env, `/v1/notes/${id}`, { token, method: 'DELETE' })
    const answer = indexAnswerOf((await index([id, 'nothing-here'])).json)
    expect(answer).toEqual(
      expect.arrayContaining([
        { id, refused: 'gone' },
        { id: 'nothing-here', refused: 'gone' },
      ]),
    )
  })

  test("words that are not the row's - a save halfway - are left out, to be asked again", async () => {
    const id = await made('Halfway.md', '# Before\n')
    await env.NOTES.put(`spaces/${space}/${id}`, '# After\n')
    expect(indexAnswerOf((await index([id])).json)).toEqual([])
  })

  test('refuses what is not a request, and more than a batch', async () => {
    expect((await index('one')).status).toBe(400)
    expect((await index(Array.from({ length: 201 }, (_, at) => `n${String(at)}`))).status).toBe(400)
  })

  test("is a reader's too, and nobody else's", async () => {
    const id = await made('Shared.md', '# Shared\n')
    const reader = await invited(env, token, space, 'reader@example.com', 'read')
    expect(indexAnswerOf((await index([id], reader)).json)).toHaveLength(1)

    const stranger = await signIn(env, 'stranger@example.com')
    expect((await index([id], stranger)).status).toBeGreaterThanOrEqual(400)
  })
})

describe('the search', () => {
  test('answers hits by id, with the line, as the browser walks', async () => {
    const plans = await made('Plans.md', '# Plans\n\nthe garden in spring\n')
    await made('Other.md', '# Other\n\nnothing here\n')
    const answer = searchAnswerOf((await search({ q: 'garden', limit: 10 })).json)
    expect(answer?.after).toBeNull()
    expect(answer?.hits).toEqual([
      expect.objectContaining({
        id: plans,
        path: 'Plans.md',
        line: 2,
        text: 'the garden in spring',
      }),
    ])
  })

  test('leaves out what the browser reads itself, what the space leaves out, and its own', async () => {
    const mine = await made('Mine.md', 'garden\n')
    await made('Drafts/Old.md', 'garden\n')
    await made('.nib/Own.md', 'garden\n')
    const kept = await made('Kept.md', 'garden\n')
    const answer = searchAnswerOf(
      (await search({ q: 'garden', limit: 10, skip: [mine], excluded: ['Drafts'] })).json,
    )
    expect(answer?.hits.map((one) => one.id)).toEqual([kept])
  })

  test('a page at a time, and on from where the last one ended', async () => {
    const ids: string[] = []
    for (let at = 0; at < 205; at += 1)
      ids.push(await made(`n${String(at)}.md`, `word ${String(at)}\n`))
    const first = searchAnswerOf((await search({ q: 'word', limit: 200 })).json)
    expect(first?.hits).toHaveLength(200)
    expect(first?.after).not.toBeNull()

    const rest = searchAnswerOf(
      (await search({ q: 'word', limit: 200, after: first?.after ?? '' })).json,
    )
    expect(rest?.after).toBeNull()
    expect(new Set([...(first?.hits ?? []), ...(rest?.hits ?? [])].map((one) => one.id))).toEqual(
      new Set(ids),
    )
  })

  test('loose guesses come back with their scores', async () => {
    await made('Garden.md', 'the gardens are green\n')
    const answer = await call(env, `/v2/spaces/${space}/search`, {
      token,
      body: { query: parseQuery('gardn'), terms: ['gardn'], limit: 10 },
    })
    const read = searchAnswerOf(answer.json)
    expect(read?.hits).toEqual([])
    expect(read?.loose[0]?.score).toBeGreaterThan(0)
  })

  test('refuses a query that is not one', async () => {
    const answer = await call(env, `/v2/spaces/${space}/search`, {
      token,
      body: { query: { kind: 'nonsense' }, terms: [], limit: 10 },
    })
    expect(answer.status).toBe(400)
  })
})
