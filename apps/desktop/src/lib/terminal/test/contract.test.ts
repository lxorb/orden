import { describe, expect, test } from 'vitest'
import { destinationOf, hostFor, readSpec, said, scrollbackOf, writeSpec } from '../src/api'

describe('a terminal file', () => {
  test('keeps its shell, folder, key and name through being written and read', () => {
    const spec = { shell: 'zsh', folder: '/home/me', key: 'k1', name: 'Build' }
    expect(readSpec(writeSpec(spec))).toMatchObject(spec)
    expect(readSpec('not json')).toBeNull()
  })
})
describe('a remote destination', () => {
  test('is read from what was typed, with or without ssh, a user and a port', () => {
    const plain = destinationOf('ssh box')
    expect(plain).toMatchObject({ hostname: 'box', user: null, port: null })
    const full = destinationOf('me@box:2222')
    expect(full && said(full)).toBe('me@box:2222')
    expect(destinationOf('two words')).toBeNull()
    expect(destinationOf('  ')).toBeNull()
  })
  test('finds no host when none is known', () => {
    const wanted = destinationOf('box')
    expect(wanted && hostFor([], wanted)).toBeNull()
  })
})
describe('the overview preview', () => {
  test('a terminal with no session and no history shows nothing', async () => {
    expect(await scrollbackOf({ id: 'none', doc: '', home: null })).toBeNull()
  })
})
