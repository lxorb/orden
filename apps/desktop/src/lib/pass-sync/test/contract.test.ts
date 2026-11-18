import { describe, expect, test } from 'vitest'
import {
  hidesPasswords,
  isPassSecret,
  mayEdit,
  mayHandOn,
  mayManage,
  pass,
  PIN_TRIES,
} from '../src/api'

describe('the module stands on its own', () => {
  test('the api loads with the vault locked and nothing listening', () => {
    expect(pass.state).toBe('loading')
    expect(pass.items).toEqual([])
    expect(PIN_TRIES).toBeGreaterThan(0)
  })
})

describe('what a role may do', () => {
  test('a viewer reads, an editor edits, a manager manages, only the owner hands on', () => {
    expect(mayEdit({ role: 'viewer' })).toBe(false)
    expect(mayEdit({ role: 'editor' })).toBe(true)
    expect(mayManage({ role: 'editor' })).toBe(false)
    expect(mayManage({ role: 'manager' })).toBe(true)
    expect(mayHandOn({ role: 'manager' })).toBe(false)
    expect(mayHandOn({ role: 'owner' })).toBe(true)
  })

  test('passwords are hidden only from a viewer of a vault that asks for it', () => {
    expect(hidesPasswords({ role: 'viewer', hidePasswordsFromViewers: true })).toBe(true)
    expect(hidesPasswords({ role: 'viewer', hidePasswordsFromViewers: false })).toBe(false)
    expect(hidesPasswords({ role: 'owner', hidePasswordsFromViewers: true })).toBe(false)
  })
})

describe('the clipboard', () => {
  test('holds no Pass secret until one is copied', () => {
    expect(isPassSecret('')).toBe(false)
    expect(isPassSecret('anything typed')).toBe(false)
  })
})
