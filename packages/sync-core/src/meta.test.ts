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
