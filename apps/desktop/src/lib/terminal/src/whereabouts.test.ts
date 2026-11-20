import { describe, expect, test } from 'vitest'
import { Whereabouts } from './whereabouts'

describe('the folder a terminal is in (#2274)', () => {
  test('is what its shell says once it has said one, not the real path the system finds for the same folder', () => {
    const where = new Whereabouts()
    expect(where.heard('shell', '/var/folders/x/a/b', '/var/folders/x/a')).toBe('/var/folders/x/a/b')
    expect(where.heard('kernel', '/private/var/folders/x/a/b', '/var/folders/x/a/b')).toBeNull()
    expect(where.heard('shell', '/var/folders/x/a', '/var/folders/x/a/b')).toBe('/var/folders/x/a')
    expect(where.heard('shell', '/var/folders/x/a', '/var/folders/x/a')).toBeNull()
  })
  test('is what the system finds for a shell that never says where it is', () => {
    const where = new Whereabouts()
    expect(where.heard('kernel', '/home/me/src', '/home/me')).toBe('/home/me/src')
    expect(where.heard('kernel', '/home/me/src', '/home/me/src')).toBeNull()
  })
})
