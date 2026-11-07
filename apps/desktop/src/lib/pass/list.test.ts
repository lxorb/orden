import { blank, newEnvelope } from '@orden/pass/envelope'
import type { Content, Item, Vault } from '@orden/pass/types'
import { describe, expect, test } from 'vitest'
import { listed, subtitleOf } from './list'

function item(id: string, content: Content, more: Partial<Item> = {}): Item {
  return { ...newEnvelope(content, 1000), id, vault: 'home', rev: 1, ...more }
}

function vault(id: string, more: Partial<Vault> = {}): Vault {
  return {
    v: 1,
    id,
    rev: 1,
    name: id,
    description: '',
    color: 'purple',
    icon: 'home',
    folders: [],
    hidePasswordsFromViewers: false,
    role: 'owner',
    members: 1,
    shared: false,
    ...more,
  }
}

const VAULTS = [
  vault('home', {
    folders: [
      { id: 'money', name: 'Money', parent: null },
      { id: 'banks', name: 'Banks', parent: 'money' },
      { id: 'games', name: 'Games', parent: null },
    ],
  }),
  vault('team', { shared: true, members: 3 }),
  vault('theirs', { role: 'editor', members: 2, shared: true }),
]

const ITEMS: Item[] = [
  item(
    'mail',
    {
      ...blank('login'),
      title: 'Mail',
      username: 'emil',
      email: 'emil@example.com',
      password: 'zebra-password',
      websites: [{ url: 'https://accounts.proton.me/login', match: 'domain' }],
    },
    { modified: 5000, created: 100 },
  ),
  item(
    'bank',
    { ...blank('login'), title: 'bank', username: 'e.vinu' },
    { folder: 'banks', pinned: true, created: 300, modified: 2000, used: 9000 },
  ),
  item(
    'visa',
    { ...blank('card'), title: 'Visa', number: '4111 1111 1111 1234', code: '987' },
    { folder: 'money', created: 200 },
  ),
  item(
    'diary',
    { ...blank('note'), title: 'Diary', note: '\n  Dear diary\nsecond line zebra' },
    { created: 400 },
  ),
  item(
    'alias',
    { ...blank('alias'), title: 'Shop', address: 'shop.x7@alias.dev' },
    { created: 50 },
  ),
  item('id', { ...blank('identity'), title: 'Me', values: { fullName: 'Emil V' } }),
  item('wifi', { ...blank('wifi'), title: 'Home wifi', ssid: 'Castle', password: 'castle-key' }),
  item('ssh', { ...blank('ssh'), title: 'Server', publicKey: 'ssh-ed25519 AAAA me@x' }),
  item('custom', { ...blank('custom'), title: 'Locker', note: 'Gym locker' }, { vault: 'team' }),
  item('old', { ...blank('login'), title: 'Old' }, { trashed: 7000, pinned: true }),
  item('given', { ...blank('note'), title: 'Given' }, { vault: 'theirs' }),
]

const ids = (items: Item[]) => items.map((one) => one.id)

describe('which items a scope shows', () => {
  test('all leaves the trash out', () => {
    const { rows } = listed(ITEMS, VAULTS, { kind: 'all' }, 'all', 'title', '')
    expect(ids(rows)).not.toContain('old')
    expect(rows).toHaveLength(10)
  })

  test('the trash shows only what was trashed, with no pinned strip', () => {
    const { rows, pinned } = listed(ITEMS, VAULTS, { kind: 'trash' }, 'all', 'title', '')
    expect(ids(rows)).toEqual(['old'])
    expect(pinned).toEqual([])
  })

  test('a vault shows its own items, and a folder its own and its subfolders’', () => {
    const vaultOnly = { kind: 'vault', vault: 'home', folder: null } as const
    expect(listed(ITEMS, VAULTS, vaultOnly, 'all', 'title', '').rows).toHaveLength(8)
    const money = { kind: 'vault', vault: 'home', folder: 'money' } as const
    expect(ids(listed(ITEMS, VAULTS, money, 'all', 'title', '').rows)).toEqual(['bank', 'visa'])
    const banks = { kind: 'vault', vault: 'home', folder: 'banks' } as const
    expect(ids(listed(ITEMS, VAULTS, banks, 'all', 'title', '').rows)).toEqual(['bank'])
    const games = { kind: 'vault', vault: 'home', folder: 'games' } as const
    expect(listed(ITEMS, VAULTS, games, 'all', 'title', '').rows).toEqual([])
  })

  test('shared with me and shared by me', () => {
    const withMe = listed(ITEMS, VAULTS, { kind: 'shared-with-me' }, 'all', 'title', '')
    expect(ids(withMe.rows)).toEqual(['given'])
    const byMe = listed(ITEMS, VAULTS, { kind: 'shared-by-me' }, 'all', 'title', '')
    expect(ids(byMe.rows)).toEqual(['custom'])
  })
})

describe('the type filter', () => {
  test('counts every type in the scope, other being custom, ssh and wifi', () => {
    const { counts } = listed(ITEMS, VAULTS, { kind: 'all' }, 'login', 'title', '')
    expect(counts).toEqual({ all: 10, login: 2, alias: 1, card: 1, note: 2, identity: 1, other: 3 })
  })

  test('shows only the type chosen', () => {
    const other = listed(ITEMS, VAULTS, { kind: 'all' }, 'other', 'title', '')
    expect(ids(other.rows)).toEqual(['wifi', 'custom', 'ssh'])
  })
})

describe('the search', () => {
  const found = (query: string) =>
    ids(listed(ITEMS, VAULTS, { kind: 'all' }, 'all', 'title', query).rows)

  test('reads titles, usernames, emails, hosts, aliases, a card’s last four and a note’s first line', () => {
    expect(found('MAIL')).toEqual(['mail'])
    expect(found('e.vinu')).toEqual(['bank'])
    expect(found('example.com')).toEqual(['mail'])
    expect(found('accounts.proton')).toEqual(['mail'])
    expect(found('x7@alias')).toEqual(['alias'])
    expect(found('1234')).toEqual(['visa'])
    expect(found('dear diary')).toEqual(['diary'])
  })

  test('never reads a password, a card’s other digits or its code, or the rest of a note', () => {
    expect(found('zebra')).toEqual([])
    expect(found('castle-key')).toEqual([])
    expect(found('4111')).toEqual([])
    expect(found('987')).toEqual([])
    expect(found('second line')).toEqual([])
  })

  test('narrows the counts too', () => {
    const { counts } = listed(ITEMS, VAULTS, { kind: 'all' }, 'all', 'title', 'emil')
    expect(counts.all).toBe(2)
    expect(counts.login).toBe(1)
    expect(counts.identity).toBe(1)
  })
})

describe('pinned and sorted', () => {
  test('pinned items are set apart and stay in the rows', () => {
    const { pinned, rows } = listed(ITEMS, VAULTS, { kind: 'all' }, 'all', 'title', '')
    expect(ids(pinned)).toEqual(['bank'])
    expect(ids(rows)).toContain('bank')
  })

  test('the four orders', () => {
    const order = (sort: 'recent' | 'title' | 'newest' | 'oldest') =>
      ids(
        listed(ITEMS, VAULTS, { kind: 'all' }, 'login', sort, '').rows.concat(
          listed(ITEMS, VAULTS, { kind: 'all' }, 'card', sort, '').rows,
        ),
      )
    expect(order('recent')).toEqual(['bank', 'mail', 'visa'])
    expect(order('title')).toEqual(['bank', 'mail', 'visa'])
    expect(order('newest')).toEqual(['bank', 'mail', 'visa'])
    expect(order('oldest')).toEqual(['mail', 'bank', 'visa'])
    const all = (sort: 'title' | 'oldest') =>
      ids(listed(ITEMS, VAULTS, { kind: 'all' }, 'all', sort, '').rows)
    expect(all('title').slice(0, 3)).toEqual(['bank', 'diary', 'given'])
    expect(all('oldest')[0]).toBe('alias')
  })
})

describe('the line under a title', () => {
  test('says what each kind is best known by', () => {
    const by = (id: string) => {
      const found = ITEMS.find((one) => one.id === id)
      if (!found) throw new Error(id)
      return subtitleOf(found)
    }
    expect(by('mail')).toBe('emil')
    expect(by('visa')).toBe('•••• 1234')
    expect(by('diary')).toBe('Dear diary')
    expect(by('alias')).toBe('shop.x7@alias.dev')
    expect(by('id')).toBe('Emil V')
    expect(by('wifi')).toBe('Castle')
    expect(by('ssh')).toBe('ssh-ed25519')
    expect(by('custom')).toBe('Gym locker')
  })
})
