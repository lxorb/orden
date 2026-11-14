import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChatMember } from '../shapes'
import { chats } from '../store.svelte'
import { ChatPage } from './chat.svelte'
import { FixtureChats } from './fixture.svelte'
import { nameOf } from './people'
import { grouped, linesOf, type Listed, listedOf, placed, visible } from './roster'
import { useStore } from './source.svelte'

afterEach(() => useStore(chats))

const one = (who: string, name: string, more: Partial<Listed> = {}): Listed => ({
  who: `guest:${who}`,
  name,
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
    ])
    expect(groups.map((group) => [group.rank, names(group.members)])).toEqual([
      ['owner', ['Olga']],
      ['member', ['Carl', 'Bob', 'anna', 'Zoe']],
      ['bot', ['Helper']],
    ])
    expect(linesOf(groups).filter((line) => line.kind === 'group')).toEqual([
      { kind: 'group', rank: 'owner', count: 1 },
      { kind: 'group', rank: 'member', count: 4 },
      { kind: 'group', rank: 'bot', count: 1 },
    ])
  })

  test('a filter keeps those whose name holds it, accents and case aside', () => {
    const list = [one('j', 'José Núñez'), one('m', 'Mia'), one('k', 'Kai', { rank: 'owner' })]
    expect(names(grouped(list, 'nunez').flatMap((group) => group.members))).toEqual(['José Núñez'])
    expect(names(grouped(list, 'MI').flatMap((group) => group.members))).toEqual(['Mia'])
    expect(grouped(list, 'nobody')).toEqual([])
    expect(grouped(list, '  ').flatMap((group) => group.members)).toHaveLength(3)
  })

  test('a list of thousands draws only the rows in sight', () => {
    const many = Array.from({ length: 5000 }, (_, at) =>
      one(`p${at}`, `Person ${String(at).padStart(4, '0')}`, {
        rank: at % 100 === 0 ? 'owner' : 'member',
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
