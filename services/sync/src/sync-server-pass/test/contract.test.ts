import { describe, expect, test } from 'vitest'
import { mayAct } from '../src/access'
import { PASS_ERASED } from '../src/erase'
import { NO_SUCH_ITEM, NO_SUCH_VAULT, ROTATED, STALE } from '../src/refusals'
import { itemRowOf, keyringRowOf } from '../src/rows'

describe('erasing an account', () => {
  test('names every pass table it clears, bound to the account and moving the sequence first', () => {
    const tables = PASS_ERASED.map(([table]) => table)
    expect(tables[0]).toBe('pass_seq')
    expect(new Set(tables)).toEqual(
      new Set([
        'pass_seq',
        'leftovers',
        ...tables.filter((table) => table.startsWith('pass_') && table !== 'pass_seq'),
      ]),
    )
    for (const [table, sql] of PASS_ERASED.slice(1)) {
      expect(sql, table).toMatch(/\?1|\?2|pass_vaults where/)
    }
  })
})

describe('vault access', () => {
  const held = (role: string) =>
    ({ role, deleted_at: null }) as unknown as Parameters<typeof mayAct>[0]

  test('an owner may do anything, an editor may edit, a viewer may only view', () => {
    expect(mayAct(held('owner'), 'owner')).toBe(true)
    expect(mayAct(held('owner'), 'viewer')).toBe(true)
    expect(mayAct(held('manager'), 'editor')).toBe(true)
    expect(mayAct(held('editor'), 'editor')).toBe(true)
    expect(mayAct(held('editor'), 'manager')).toBe(false)
    expect(mayAct(held('viewer'), 'editor')).toBe(false)
    expect(mayAct(held('viewer'), 'viewer')).toBe(true)
  })

  test('refusals are the words the client matches on', () => {
    expect([STALE, ROTATED, NO_SUCH_VAULT, NO_SUCH_ITEM]).toEqual([
      'stale',
      'the vault has a newer key',
      'no such vault',
      'no such item',
    ])
  })
})

describe('rows on the wire', () => {
  test('an item row carries its revision, key version and deletion', () => {
    const row = itemRowOf({
      vault_id: 'v',
      id: 'i',
      rev: 3,
      key: 'k',
      body: 'b',
      key_version: 2,
      at: 10,
      deleted_at: null,
    })
    expect(row).toMatchObject({ id: 'i', rev: 3, keyVersion: 2 })
  })

  test('a keyring row needs a keyring to show', () => {
    expect(keyringRowOf({ keyring: '', rev: 1 })).toBeNull()
  })
})
