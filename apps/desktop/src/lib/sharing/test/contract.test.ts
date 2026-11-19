import { describe, expect, test } from 'vitest'
import { joining, protectionOn } from '../src/api'
import { addressesIn, looksLikeAddress } from '../src/sharing.svelte'

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
