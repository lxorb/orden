import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { feedPage } from '../src/sync2/feed'
import { applyOps } from '../src/sync2/ops'
import { prepareSpace } from '../src/sync2/prepare'
import type { Reached } from '../src/spaces/space'
import { hooks, wire } from '../src/hooks'
import { type TestEnv, testEnv } from './fakes'

type Op = Parameters<typeof applyOps>[4][number]

const PAGE = 1000
const USER = 'user-1'
const SPACE = 'space-1'
const DEVICE = 'device-1'

let env: TestEnv
let counter = 0

function op(t: Op['t'], fields: Record<string, unknown>): Op {
  counter += 1
  return { op: `op-${String(counter)}`, t, seen: 0, ...fields } as unknown as Op
}

function note(id: string, name: string, parent: string | null = null): Op {
  return op('create', { id, kind: 'note', parent, name })
}

function reached(): Reached {
  const row = env.db.prepare('select * from spaces where id = ?').get(SPACE) as Reached
  return { ...row, role: 'owner' }
}

async function heardFromZero(): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = []
  let since = 0
  let pages = 0
  for (; pages < 20; pages += 1) {
    const page = await feedPage(env, SPACE, since)
    ids.push(...page.items.map((item) => item.id))
    since = page.cursor
    if (!page.more) break
  }
  return { ids, pages: pages + 1 }
}

function ops(list: readonly Op[]) {
  return applyOps(env, reached(), USER, DEVICE, list)
}

function names(ids: readonly string[]): string[] {
  return ids.map(
    (id) =>
      (env.db.prepare('select name from notes where id = ?').get(id) as { name: string }).name,
  )
}

beforeEach(() => {
  env = testEnv()
  env.db
    .prepare('insert into users (id, email, created_at) values (?, ?, 1)')
    .run(USER, 'one@example.com')
  env.db
    .prepare(
      'insert into spaces (id, user_id, name, created_at, updated_at) values (?, ?, ?, 1, 1)',
    )
    .run(SPACE, USER, 'Contract')
})

afterEach(() => env.close())

describe('the feed', () => {
  test('a new device reading from 0 hears the whole tree, past rows the tree never names', async () => {
    await ops([note('n-first', 'first.md')])
    const { next } = env.db
      .prepare('select next from space_cursor where space_id = ?')
      .get(SPACE) as { next: number }
    env.db
      .prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
         values ('gone-long-ago', ?, 'Old/gone.md', ?, 1, 1, 1, 0, '')`,
      )
      .run(SPACE, next)
    env.db.prepare('update space_cursor set next = ? where space_id = ?').run(next + 1, SPACE)
    await ops([op('mkdir', { id: 'f-work', parent: null, name: 'Work' })])
    await ops([note('n-a', 'a.md'), note('n-b', 'b.md', 'f-work')])
    await prepareSpace(env, SPACE)

    const { ids } = await heardFromZero()
    expect(ids).toEqual(expect.arrayContaining(['n-first', 'f-work', 'n-a', 'n-b']))
    expect(ids).not.toContain('gone-long-ago')
  })

  test('pages by seq, says when more follows, and keeps deleted items in the feed', async () => {
    const many = Array.from({ length: PAGE + 5 }, (_, at) =>
      note(`n-${String(at)}`, `${String(at)}.md`),
    )
    await ops(many)
    await ops([op('delete', { id: 'n-3' })])

    const first = await feedPage(env, SPACE, 0)
    expect(first.items.length).toBe(PAGE)
    expect(first.more).toBe(true)
    expect(first.cursor).toBe(first.items.at(-1)?.seq)
    expect(first.items.map((item) => item.seq)).toEqual(
      [...first.items.map((item) => item.seq)].sort((one, other) => one - other),
    )

    const { ids, pages } = await heardFromZero()
    expect(pages).toBe(2)
    expect(new Set(ids).size).toBe(PAGE + 5)
    const deleted = (await feedPage(env, SPACE, first.cursor)).items.find(
      (item) => item.id === 'n-3',
    )
    expect(deleted?.deleted).toBe(true)
  })
})

describe('tree operations', () => {
  test('applying the same ops twice answers the same and changes nothing more', async () => {
    const batch = [
      op('mkdir', { id: 'f-1', parent: null, name: 'Plans' }),
      note('n-1', 'Q3.md', 'f-1'),
      op('rename', { id: 'f-1', name: 'Roadmap' }),
    ]
    const once = await ops(batch)
    const rows = () =>
      env.db.prepare('select count(*) as n from notes where space_id = ?').get(SPACE)
    const before = rows()
    const again = await ops(batch)

    expect(again.value).toEqual(once.value)
    expect(again.changed).toBe(false)
    expect(rows()).toEqual(before)
    expect(names(['n-1'])).toEqual(['Q3.md'])
  })

  test('a taken name is numbered, comparing names as Windows and macOS do', async () => {
    const { value } = await ops([
      note('p-1', 'Plan.md'),
      note('p-2', 'plan.md'),
      note('c-1', 'Café.md'),
      note('c-2', 'Café.md'),
    ])
    expect(value.every((one) => 'ok' in one)).toBe(true)
    expect(names(['p-1', 'p-2', 'c-1', 'c-2'])).toEqual([
      'Plan.md',
      'plan 2.md',
      'Café.md',
      'Café 2.md',
    ])
  })

  test('refuses a parent that does not exist instead of inventing it', async () => {
    const { value } = await ops([note('lost', 'lost.md', 'no-such-folder')])
    expect(value).toEqual([{ op: expect.any(String), refused: 'gone' }])
  })
})

describe('hooks', () => {
  test('the composition root wires the other services; until then the core says so', () => {
    expect(() => hooks()).toThrow(/wire/)
    const wired = {
      accounts: {
        whoever: () => Promise.resolve(null),
        signingIn: () => Promise.resolve({ second: true as const, holding: '' }),
        sessionFor: () => Promise.resolve({ token: '', user: { id: '', email: '', name: null } }),
      },
      blog: { publishesFile: () => Promise.resolve(false) },
      chats: {
        askChat: () => Promise.resolve(null),
        chatsRevoked: () => Promise.resolve(),
        closeChats: () => Promise.resolve(),
        eraseChats: (_env: unknown, chats: readonly string[]) => Promise.resolve([...chats]),
        linkPointer: () => Promise.resolve(),
      },
      feedback: {
        withdrawIssues: (_env: unknown, numbers: readonly number[]) =>
          Promise.resolve([...numbers]),
      },
      machines: {
        eraseMachines: (_env: unknown, ids: readonly string[]) => Promise.resolve([...ids]),
        endTerms: () => Promise.resolve(),
        endingTerm: () => env.DB.prepare('select 1'),
        tellEnded: () => Promise.resolve(),
        machinesRevoked: () => Promise.resolve(),
        machinesSignedOut: () => Promise.resolve(),
      },
      pass: { erased: [] },
    }
    wire(wired)
    expect(hooks()).toBe(wired)
  })
})
