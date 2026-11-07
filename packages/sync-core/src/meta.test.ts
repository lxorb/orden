import { describe, expect, test } from 'vitest'
import { metaFromText, metaOf, metaPatchOf, metaText, patched, sameMeta } from './meta'
import { opOf } from './wire'

describe('item metadata', () => {
  test('reads only short lowercase keys with words in them', () => {
    expect(metaOf({ icon: 'rocket', 'icon-color': 'red' })).toEqual({
      icon: 'rocket',
      'icon-color': 'red',
    })
    for (const bad of [{ Icon: 'x' }, { icon: '' }, { icon: 3 }, [], null, 'icon']) {
      expect(metaOf(bad)).toBeNull()
    }
    expect(metaOf({ icon: 'x'.repeat(2049) })).toBeNull()
    expect(
      metaOf(Object.fromEntries(Array.from({ length: 17 }, (_, at) => [`k${at}`, 'v']))),
    ).toBeNull()
  })

  test('a patch sets and clears keys, and says nothing when it would change nothing', () => {
    expect(metaPatchOf({})).toBeNull()
    expect(metaPatchOf({ icon: null })).toEqual({ icon: null })
    expect(patched({ icon: 'a', cover: 'b' }, { icon: null, tint: 'c' })).toEqual({
      cover: 'b',
      tint: 'c',
    })
    expect(patched({ icon: 'a' }, { icon: null })).toBeUndefined()
    expect(sameMeta(undefined, {})).toBe(true)
    expect(sameMeta({ icon: 'a' }, { icon: 'b' })).toBe(false)
  })

  test("a list's kept done days from two devices are merged todo by todo, not one over the other", () => {
    const one = patched({ 'done-on': 'aaa:20261101' }, { 'done-on': 'bbb:20261105' })
    expect(one).toEqual({ 'done-on': 'bbb:20261105 aaa:20261101' })
    expect(
      patched({ 'done-on': 'aaa:20261101 bbb:20261102' }, { 'done-on': 'bbb:20261103 bbb:-' }),
    ).toEqual({ 'done-on': 'bbb:20261103 bbb:- aaa:20261101' })
    expect(patched({ 'done-on': 'aaa:20261101', icon: 'x' }, { 'done-on': null })).toEqual({
      icon: 'x',
    })
    expect(patched({ 'cancelled-on': 'aaa:20261101' }, { 'cancelled-on': 'ccc:20261102' })).toEqual(
      { 'cancelled-on': 'ccc:20261102 aaa:20261101' },
    )
    expect(patched({ icon: 'a' }, { icon: 'b' })).toEqual({ icon: 'b' })
  })

  test('a merged value never grows past what a value may hold', () => {
    const many = Array.from({ length: 300 }, (_, at) => `h${at}:20261101`).join(' ')
    const merged = patched({ 'done-on': many }, { 'done-on': 'new:20261107' })?.['done-on'] ?? ''
    expect(merged.startsWith('new:20261107 h0:20261101')).toBe(true)
    expect(merged.length).toBeLessThanOrEqual(2048)
  })

  test('text round-trips in one order whatever order the keys came in', () => {
    expect(metaText({ b: '2', a: '1' })).toBe('{"a":"1","b":"2"}')
    expect(metaText({})).toBeNull()
    expect(metaFromText('{"a":"1"}')).toEqual({ a: '1' })
    expect(metaFromText('{}')).toBeUndefined()
    expect(metaFromText('nonsense')).toBeUndefined()
  })

  test('the op is read off the wire, and a bad one is refused', () => {
    expect(opOf({ op: 'o1', t: 'meta', id: 'n1', seen: 0, meta: { icon: 'x' } })).toEqual({
      op: 'o1',
      t: 'meta',
      id: 'n1',
      seen: 0,
      meta: { icon: 'x' },
    })
    expect(opOf({ op: 'o1', t: 'meta', id: 'n1', seen: 0, meta: { ICON: 'x' } })).toBeNull()
  })
})
