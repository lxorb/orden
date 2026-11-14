import { expect, test } from 'vitest'
import { carryKeys } from './former-keys'

class Held implements Storage {
  items = new Map<string, string>()
  full = false

  get length(): number {
    return this.items.size
  }

  key(at: number): string | null {
    return [...this.items.keys()][at] ?? null
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.full) throw new DOMException('full', 'QuotaExceededError')
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  clear(): void {
    this.items.clear()
  }
}

test('what was kept under the old name is kept under the new one, and the old key goes', () => {
  const held = new Held()
  held.setItem('nib:theme-scheme', 'dark')
  held.setItem('nib:workspace', '{"tabs":[]}')
  held.setItem('other', 'x')

  carryKeys(held)

  expect(Object.fromEntries(held.items)).toEqual({
    other: 'x',
    'orden:theme-scheme': 'dark',
    'orden:workspace': '{"tabs":[]}',
  })
})

test('a key named with a dot after the old name is carried too, and a word that only starts like it is left', () => {
  const held = new Held()
  held.setItem('nib.chat-hush', '{}')
  held.setItem('nib.tray', 'menu')
  held.setItem('nibble:x', 'kept')

  carryKeys(held)

  expect(Object.fromEntries(held.items)).toEqual({
    'nibble:x': 'kept',
    'orden.chat-hush': '{}',
    'orden.tray': 'menu',
  })
})

test('a value already kept under the new name is never written over', () => {
  const held = new Held()
  held.setItem('orden:theme-scheme', 'light')
  held.setItem('nib:theme-scheme', 'dark')

  carryKeys(held)

  expect(Object.fromEntries(held.items)).toEqual({ 'orden:theme-scheme': 'light' })
})

test('a value the storage has no room to copy stays where it was, to move on a later run', () => {
  const held = new Held()
  held.setItem('nib:workspace', 'big')
  held.full = true

  carryKeys(held)
  expect(Object.fromEntries(held.items)).toEqual({ 'nib:workspace': 'big' })

  held.full = false
  carryKeys(held)
  expect(Object.fromEntries(held.items)).toEqual({ 'orden:workspace': 'big' })
})

test('a language chosen when Orden spoke more than English is let go', () => {
  const held = new Held()
  held.setItem('orden:language', 'de')
  held.setItem('orden:theme', 'dark')

  carryKeys(held)

  expect(Object.fromEntries(held.items)).toEqual({ 'orden:theme': 'dark' })
})
