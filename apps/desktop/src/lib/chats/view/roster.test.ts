import { fakeProvider, OPTIONAL, type FakeProvider } from '@orden/chats/fake-provider'
import type { Host, Member } from '@orden/chats/provider'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChatMember } from '../api'
import { connected as hub } from '../connected.svelte'
import { conversationKey } from '../conversation-key'
import { whoOf } from '../remote.svelte'
import { chats } from '../store.svelte'
import { ChatPage } from './chat.svelte'
import { FixtureChats } from './fixture.svelte'
import { nameOf } from './people'
import { grouped, linesOf, type Listed, listedOf, placed, visible } from './roster'
import { useStore } from './source.svelte'

const host: Host = {
  secret: () => Promise.resolve(null),
  keepSecret: () => Promise.resolve(),
  fetch: globalThis.fetch,
  now: () => Date.now(),
}

afterEach(async () => {
  useStore(chats)
  for (const one of hub.linked) await hub.unlink(one.provider.id, one.account.id)
})

const one = (who: string, name: string, more: Partial<Listed> = {}): Listed => ({
  who: `guest:${who}`,
  name,
  handle: null,
  rank: 'member',
  presence: null,
  ...more,
})

const names = (list: readonly Listed[]) => list.map((it) => it.name)

function rosterOf(page: ChatPage) {
  return grouped(
    listedOf(
      page.view.members,
      (who) => nameOf(who, page.members, null),
      (who) => (page.view.presence.here.includes(who) ? 'active' : null),
    ),
  )
}

function shapeOf(page: ChatPage) {
  return rosterOf(page).map((group) => [group.rank, names(group.members)])
}

describe('the members of a chat in groups', () => {
  test('come by role, the online first and then by name, each group counted', () => {
    const groups = grouped([
      one('z', 'Zoe'),
      one('a', 'anna'),
      one('o', 'Olga', { rank: 'owner' }),
      one('b', 'Bob', { presence: 'away' }),
      one('c', 'Carl', { presence: 'active' }),
      one('h', 'Helper', { rank: 'bot' }),
      one('m', 'Mod', { rank: 'admin' }),
    ])
    expect(groups.map((group) => [group.rank, names(group.members)])).toEqual([
      ['owner', ['Olga']],
      ['admin', ['Mod']],
      ['member', ['Carl', 'Bob', 'anna', 'Zoe']],
      ['bot', ['Helper']],
    ])
    expect(linesOf(groups).filter((line) => line.kind === 'group')).toEqual([
      { kind: 'group', rank: 'owner', count: 1 },
      { kind: 'group', rank: 'admin', count: 1 },
      { kind: 'group', rank: 'member', count: 4 },
      { kind: 'group', rank: 'bot', count: 1 },
    ])
  })

  test('a filter keeps those whose name or address holds it, accents and case aside', () => {
    const list = [
      one('j', 'José Núñez', { handle: 'jose@example.org' }),
      one('m', 'Mia', { handle: '+41 79 000 00 01' }),
      one('k', 'Kai', { rank: 'owner' }),
    ]
    expect(names(grouped(list, 'nunez').flatMap((group) => group.members))).toEqual(['José Núñez'])
    expect(names(grouped(list, 'EXAMPLE').flatMap((group) => group.members))).toEqual([
      'José Núñez',
    ])
    expect(names(grouped(list, '79 000').flatMap((group) => group.members))).toEqual(['Mia'])
    expect(grouped(list, 'nobody')).toEqual([])
    expect(grouped(list, '  ').flatMap((group) => group.members)).toHaveLength(3)
  })

  test('a list of thousands draws only the rows in sight', () => {
    const many = Array.from({ length: 5000 }, (_, at) =>
      one(`p${at}`, `Person ${String(at).padStart(4, '0')}`, {
        rank: at % 100 === 0 ? 'admin' : 'member',
      }),
    )
    const laid = placed(linesOf(grouped(many)), { group: 36, member: 44 })
    expect(laid.total).toBe(2 * 36 + 5000 * 44)
    const shown = visible(laid.rows, 44 * 2000, 44 * 2000 + 600)
    expect(shown.length).toBeLessThan(20)
    expect(shown[0]?.top).toBeLessThanOrEqual(44 * 2000)
    expect((shown.at(-1)?.top ?? 0) + 44).toBeGreaterThanOrEqual(44 * 2000 + 600)
    expect(visible(laid.rows, 0, 100).map((row) => row.line.kind)).toEqual([
      'group',
      'member',
      'member',
    ])
  })
})

interface Shape {
  provider: string
  members: Member[]
  joins: Member
  start: [string, string[]][]
  after: [string, string[]][]
}

const me: Member = { id: 'me', name: 'Me', handle: 'me', role: 'member' }

const SHAPES: Shape[] = [
  {
    provider: 'slack',
    members: [
      { id: 'ada', name: 'Ada Lovelace', handle: 'ada', role: 'owner', online: true },
      { ...me, role: 'admin' },
      { id: 'bo', name: 'Bo Chen', handle: 'bo', role: 'member', online: false },
      { id: 'deploy', name: 'Deploy Bot', handle: 'deploybot', role: 'member', bot: true },
    ],
    joins: { id: 'eve', name: 'Eve Ito', handle: 'eve', role: 'member' },
    start: [
      ['owner', ['Ada Lovelace']],
      ['admin', ['Me']],
      ['member', ['Bo Chen']],
      ['bot', ['Deploy Bot']],
    ],
    after: [
      ['owner', ['Ada Lovelace']],
      ['admin', ['Me']],
      ['member', ['Eve Ito']],
      ['bot', ['Deploy Bot']],
    ],
  },
  {
    provider: 'telegram',
    members: [
      { id: 'u1', name: 'Ada Lovelace', handle: 'ada', role: 'owner' },
      { id: 'u2', name: 'Bo Chen', handle: 'bo', role: 'admin' },
      { ...me, role: 'member' },
      { id: 'u9', name: 'Quiz Bot', handle: 'quizbot', role: 'member', bot: true },
    ],
    joins: { id: 'u5', name: 'Eve Ito', phone: '+41790000005', role: 'member' },
    start: [
      ['owner', ['Ada Lovelace']],
      ['admin', ['Bo Chen']],
      ['member', ['Me']],
      ['bot', ['Quiz Bot']],
    ],
    after: [
      ['owner', ['Ada Lovelace']],
      ['member', ['Eve Ito', 'Me']],
      ['bot', ['Quiz Bot']],
    ],
  },
  {
    provider: 'whatsapp',
    members: [
      { id: '41790000001', name: 'Ada Lovelace', phone: '+41790000001', role: 'owner' },
      { id: '41790000002', name: 'Bo Chen', phone: '+41790000002', role: 'admin' },
      { ...me, role: 'member' },
    ],
    joins: { id: '41790000005', name: 'Eve Ito', phone: '+41790000005', role: 'member' },
    start: [
      ['owner', ['Ada Lovelace']],
      ['admin', ['Bo Chen']],
      ['member', ['Me']],
    ],
    after: [
      ['owner', ['Ada Lovelace']],
      ['member', ['Eve Ito', 'Me']],
    ],
  },
  {
    provider: 'signal',
    members: [
      { id: 'aci-ada', name: 'Ada Lovelace', phone: '+41790000001', role: 'admin' },
      { ...me, role: 'member' },
      { id: 'aci-bo', name: 'Bo Chen', phone: '+41790000002', role: 'member' },
    ],
    joins: { id: 'aci-eve', name: 'Eve Ito', role: 'member' },
    start: [
      ['admin', ['Ada Lovelace']],
      ['member', ['Bo Chen', 'Me']],
    ],
    after: [
      ['admin', ['Ada Lovelace']],
      ['member', ['Eve Ito', 'Me']],
    ],
  },
]

async function linked(id: string, methods = OPTIONAL, mine?: Member) {
  const fake = fakeProvider({ id, name: id, methods })
  const link = await hub.link(fake, { name: 'acct' }, host)
  if (mine) fake.world.change('team', { role: mine.role })
  const chat = conversationKey({
    provider: fake.id,
    account: link.account.id,
    conversation: 'team',
  })
  return { fake, chat }
}

const mineOf = (shape: Shape) => shape.members.find((it) => it.id === 'me')

function leaveAndJoin(fake: FakeProvider, gone: string[], joins: Member, how: 'count' | 'line') {
  const list = (fake.world.members.get('team') ?? []).filter((it) => !gone.includes(it.id))
  fake.world.members.set('team', [...list, joins])
  if (how === 'count') fake.world.change('team', { members: list.length + 1 })
  else fake.world.say('team', joins.id, `${joins.name} joined`, { system: true })
}

describe.each(SHAPES)('the members of a $provider conversation', (shape) => {
  test('come grouped as the service ranks them, with their addresses and who is online', async () => {
    const { fake, chat } = await linked(`fake-${shape.provider}`, OPTIONAL, mineOf(shape))
    fake.world.members.set('team', shape.members)
    const page = new ChatPage(chat)
    await vi.waitFor(() => expect(shapeOf(page)).toEqual(shape.start))
    const listed = rosterOf(page).flatMap((group) => group.members)
    for (const member of shape.members) {
      if (member.id === 'me') continue
      const found = listed.find((it) => it.who === whoOf(member.id))
      expect(found?.handle ?? null).toBe(member.handle ?? member.phone ?? null)
      if (member.online) expect(found?.presence).toBe('active')
    }
    page.close()
  })

  test.each(['count', 'line'] as const)(
    'follow people joining and leaving, told by a %s',
    async (how) => {
      const { fake, chat } = await linked(`fake-${shape.provider}-${how}`, OPTIONAL, mineOf(shape))
      fake.world.members.set('team', shape.members)
      const page = new ChatPage(chat)
      await vi.waitFor(() => expect(shapeOf(page)).toEqual(shape.start))
      const leaving = shape.members
        .filter((it) => it.id !== 'me' && it.role !== 'owner' && !it.bot)
        .filter((it) => shape.provider !== 'signal' || it.role !== 'admin')
        .map((it) => it.id)
      leaveAndJoin(fake, leaving, shape.joins, how)
      await vi.waitFor(() => expect(shapeOf(page)).toEqual(shape.after), { timeout: 4000 })
      page.close()
    },
  )
})

describe('the people of a mail thread', () => {
  test('are its participants by address, and one the thread gains shows at once', async () => {
    const { fake, chat } = await linked(
      'fake-mail',
      OPTIONAL.filter((it) => it !== 'members'),
    )
    fake.world.change('team', {
      people: [
        { id: 'ada@example.org', name: 'Ada Lovelace', handle: 'ada@example.org' },
        { id: 'bo@example.org', name: 'bo@example.org', handle: 'bo@example.org' },
      ],
    })
    const page = new ChatPage(chat)
    await vi.waitFor(() =>
      expect(
        rosterOf(page)
          .flatMap((group) => group.members)
          .filter((it) => it.handle?.includes('@'))
          .map((it) => it.handle),
      ).toEqual(['ada@example.org', 'bo@example.org']),
    )
    fake.world.change('team', {
      people: [
        ...(fake.world.conversations.find((it) => it.id === 'team')?.people ?? []),
        { id: 'eve@example.org', name: 'Eve Ito', handle: 'eve@example.org' },
      ],
    })
    await vi.waitFor(
      () =>
        expect(
          rosterOf(page)
            .flatMap((group) => group.members)
            .map((it) => it.handle),
        ).toContain('eve@example.org'),
      { timeout: 4000 },
    )
    page.close()
  })
})

describe("the members of Orden's own chat", () => {
  const OWNER: ChatMember = { who: 'user:emil', name: 'Emil Vinu', role: 'owner' }
  const LUCILE: ChatMember = { who: 'user:lucile', name: 'Lucile', role: 'write' }
  const AGENT: ChatMember = { who: 'program:scribe', name: 'Scribe', role: 'write' }
  const MIA: ChatMember = { who: 'user:mia', name: 'Mia Keller', role: 'read' }

  test('come as owners, members and bots, and follow joins and leaves', async () => {
    const fixture = new FixtureChats(OWNER.who, { seed: 3 })
    const chat = fixture.add('team', [OWNER, LUCILE, AGENT])
    useStore(fixture)
    const page = new ChatPage(chat)
    await vi.waitFor(() =>
      expect(shapeOf(page)).toEqual([
        ['owner', ['Emil Vinu']],
        ['member', ['Lucile']],
        ['bot', ['Scribe']],
      ]),
    )
    fixture.seat(chat, [OWNER, AGENT, MIA])
    await vi.waitFor(() =>
      expect(shapeOf(page)).toEqual([
        ['owner', ['Emil Vinu']],
        ['member', ['Mia Keller']],
        ['bot', ['Scribe']],
      ]),
    )
    expect(fixture.entry(chat)?.members).toBe(3)
    page.close()
  })
})
