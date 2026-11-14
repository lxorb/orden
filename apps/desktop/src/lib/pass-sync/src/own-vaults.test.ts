import { blank, newEnvelope } from '@orden/pass/envelope'
import type { Item, Role, Vault } from '@orden/pass/types'
import { describe, expect, test } from 'vitest'
import { ownVaults } from './own-vaults'

function vault(id: string, role: Role): Vault {
  return {
    v: 1,
    id,
    rev: 1,
    role,
    members: 2,
    shared: role !== 'owner',
    name: id,
    description: '',
    color: 'purple',
    icon: 'home',
    folders: [],
    hidePasswordsFromViewers: false,
  }
}

function item(id: string, inside: string): Item {
  return { ...newEnvelope({ ...blank('note'), title: id }, 1), id, vault: inside, rev: 1 }
}

describe('what an export holds', () => {
  test('is the vaults the reader owns and their items, never a vault shared with them', () => {
    const vaults = [vault('mine', 'owner'), vault('theirs', 'manager'), vault('seen', 'viewer')]
    const items = [item('a', 'mine'), item('b', 'theirs'), item('c', 'seen'), item('d', 'mine')]
    const own = ownVaults(vaults, items)
    expect(own.map((one) => one.vault.id)).toEqual(['mine'])
    expect(own[0]?.items.map((one) => one.id)).toEqual(['a', 'd'])
  })
})
