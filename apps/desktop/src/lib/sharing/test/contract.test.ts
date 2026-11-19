import { describe, expect, test } from 'vitest'
import { joining, managesSpace, members, protectionOn, share } from '../src/api'
import { addressesIn, isFull, looksLikeAddress } from '../src/sharing.svelte'

describe('the module stands on its own', () => {
  test('the invitation and the protection switch are there to read', () => {
    expect(joining.invitation).toBeNull()
    expect(typeof protectionOn()).toBe('boolean')
  })
})
describe('inviting', () => {
  test('addresses are read from what was typed, once each whatever their case', () => {
    expect(addressesIn('Ann <ann@example.org>, bob@example.com; ANN@example.org')).toEqual([
      'ann@example.org',
      'bob@example.com',
    ])
  })
  test('an address needs a name, an at and a dotted domain', () => {
    expect(looksLikeAddress('bob@example.com')).toBe(true)
    expect(looksLikeAddress('bob@example')).toBe(false)
    expect(looksLikeAddress('bob example.com')).toBe(false)
  })
})
describe('the places in a space', () => {
  test('are full once every one is taken, or more, and never where nobody counted them', () => {
    expect(isFull({ used: 9, most: 10 })).toBe(false)
    expect(isFull({ used: 10, most: 10 })).toBe(true)
    expect(isFull({ used: 11, most: 10 })).toBe(true)
    expect(isFull(null)).toBe(false)
  })
})
describe('the people in a space', () => {
  test('a folder that never reached the account is managed by whoever holds it', () => {
    expect(managesSpace('Nowhere')).toBe(true)
  })
  test('Settings reads them through a store of its own, apart from the Share sheet', () => {
    expect(members).not.toBe(share)
    expect(members.open).toBe(false)
    expect(members.who).toBeNull()
  })
})
