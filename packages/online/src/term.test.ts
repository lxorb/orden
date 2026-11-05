import { describe, expect, it } from 'vitest'
import { termOf, termText } from './term'

describe('a .term file', () => {
  const term = { v: 1, machine: 'm_7J2', session: 's_01J' } as const

  it('reads back what it wrote', () => {
    expect(termOf(termText(term))).toEqual(term)
  })

  it('is one line of JSON with the fields in order', () => {
    expect(termText(term)).toBe('{"v":1,"machine":"m_7J2","session":"s_01J"}\n')
  })

  it('reads the documented spelling, spaces and all', () => {
    expect(termOf('{ "v": 1, "machine": "m_7J2", "session": "s_01J" }')).toEqual(term)
  })

  it('drops fields it does not know, so a later version may add one', () => {
    expect(termOf('{"v":1,"machine":"m","session":"s","colour":"red"}')).toEqual({
      v: 1,
      machine: 'm',
      session: 's',
    })
  })

  it('keeps the icon chosen for it and its colour, and nothing that is not one', () => {
    const worn = { ...term, icon: 'lucide:rocket', iconColor: 'violet' }
    expect(termOf(termText(worn))).toEqual(worn)
    expect(termText(worn)).toBe(
      '{"v":1,"machine":"m_7J2","session":"s_01J","icon":"lucide:rocket","iconColor":"violet"}\n',
    )
    expect(termOf('{"v":1,"machine":"m","session":"s","icon":7,"iconColor":"red"}')).toEqual({
      v: 1,
      machine: 'm',
      session: 's',
    })
    expect(termText({ ...term, iconColor: 'red' })).toBe(termText(term))
  })

  it.each([
    '',
    'Terminal',
    'null',
    '[1]',
    '{"machine":"m","session":"s"}',
    '{"v":2,"machine":"m","session":"s"}',
    '{"v":"1","machine":"m","session":"s"}',
    '{"v":1,"machine":"","session":"s"}',
    '{"v":1,"machine":"m"}',
    '{"v":1,"machine":"m","session":7}',
    '{"v":1,"machine":"m x","session":"s"}',
    `{"v":1,"machine":"${'m'.repeat(201)}","session":"s"}`,
  ])('is not a terminal when it reads %s', (text) => {
    expect(termOf(text)).toBeNull()
  })
})
