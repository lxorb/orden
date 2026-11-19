import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { feedPage } from '../src/sync2/feed'
import { applyOps } from '../src/sync2/ops'
import { prepareSpace } from '../src/sync2/prepare'
import { MOST_IN_A_SPACE, NO_SEAT_LEFT, roomForASeat, seatsUsed } from '../src/spaces/share'
import { isIcon, readIcons } from '../src/spaces/icons'
import { type TestEnv, testEnv } from '../../sync-server/test/fakes'

type Op = Parameters<typeof applyOps>[4][number]
type Reached = Parameters<typeof applyOps>[1]
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
  return ids.map((id) => (env.db.prepare('select name from notes where id = ?').get(id) as { name: string }).name)
}
beforeEach(() => {
  env = testEnv()
  env.db.prepare('insert into users (id, email, created_at) values (?, ?, 1)').run(USER, 'one@example.com')
  env.db
    .prepare('insert into spaces (id, user_id, name, created_at, updated_at) values (?, ?, ?, 1, 1)')
    .run(SPACE, USER, 'Contract')
})
afterEach(() => env.close())
describe('the feed', () => {
  test('a new device reading from 0 hears the whole tree, past rows the tree never names', async () => {
    await ops([note('n-first', 'first.md')])
    const { next } = env.db.prepare('select next from space_cursor where space_id = ?').get(SPACE) as { next: number }
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
    const many = Array.from({ length: PAGE + 5 }, (_, at) => note(`n-${String(at)}`, `${String(at)}.md`))
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
    const deleted = (await feedPage(env, SPACE, first.cursor)).items.find((item) => item.id === 'n-3')
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
    const rows = () => env.db.prepare('select count(*) as n from notes where space_id = ?').get(SPACE)
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
    expect(names(['p-1', 'p-2', 'c-1', 'c-2'])).toEqual(['Plan.md', 'plan 2.md', 'Café.md', 'Café 2.md'])
  })
  test('refuses a parent that does not exist instead of inventing it', async () => {
    const { value } = await ops([note('lost', 'lost.md', 'no-such-folder')])
    expect(value).toEqual([{ op: expect.any(String), refused: 'gone' }])
  })
})
describe('icons', () => {
  const PNG = 'data:image/png;base64,'
  const picture = (length: number) => `${PNG}${'A'.repeat(length - PNG.length)}`
  test('a PNG data URL of up to 2048 characters is one, and no other data', () => {
    expect(isIcon(picture(2048))).toBe(true)
    expect(isIcon(picture(2049))).toBe(false)
    expect(isIcon('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isIcon('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isIcon(`${PNG}not base64!`)).toBe(false)
  })
  test('a stored map keeps its pictures', () => {
    const stored = JSON.stringify({ Work: picture(2048), Home: 'Folder', Bad: 'data:text/html;base64,PHA+' })
    expect(readIcons(stored)).toEqual({ Work: picture(2048), Home: 'Folder' })
  })
})
describe('the people a shared space holds', () => {
  const member = (email: string, item: string, joined: number | null, expires: number | null) =>
    env.db
      .prepare(
        `insert into space_members (space_id, email, item, role, joined_at, expires_at, created_at)
         values (?, ?, ?, 'read', ?, ?, 1)`,
      )
      .run(SPACE, email, item, joined, expires)
  const guest = (id: string, joined: number | null, declined: number | null) => {
    env.db.prepare("insert into guests (id, name, created_at) values (?, 'Guest', 1)").run(id)
    env.db
      .prepare(
        `insert into guest_members (space_id, guest_id, item, role, joined_at, declined_at, created_at)
         values (?, ?, '', 'read', ?, ?, 1)`,
      )
      .run(SPACE, id, joined, declined)
  }
  test('are ten at most, the owner among them, and a refusal says so', () => {
    expect(MOST_IN_A_SPACE).toBe(10)
    expect(NO_SEAT_LEFT).toBe('a shared space holds at most 10 people, the owner included')
  })
  test('are counted as the owner, members in, invitations still open, and guests let in', async () => {
    expect(await seatsUsed(env, SPACE)).toBe(1)
    member('in@example.com', '', 1, null)
    member('open@example.com', '', null, Date.now() + 60_000)
    member('ran-out@example.com', '', null, Date.now() - 1)
    member('note@example.com', 'n-1', 1, null)
    guest('g-in', 1, null)
    guest('g-waiting', null, null)
    guest('g-declined', null, 1)
    expect(await seatsUsed(env, SPACE)).toBe(4)
  })
  test('leave room for a note shared on its own whatever the space holds', async () => {
    for (let one = 0; one < 12; one++) member(`m${String(one)}@example.com`, '', 1, null)
    expect(await roomForASeat(env, SPACE, '')).toBe(false)
    expect(await roomForASeat(env, SPACE, 'n-1')).toBe(true)
  })
})
