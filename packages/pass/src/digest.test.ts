import { describe, expect, test } from 'vitest'
import { sha256Hex } from './digest'

describe('sha256Hex', () => {
  test('is the SHA-256 of the text as UTF-8, in hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
