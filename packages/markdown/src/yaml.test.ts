import { describe, expect, test } from 'vitest'
import { flowItems, listItem, unquoted } from './yaml'

describe('a quoted value', () => {
  test('loses the quotes around the whole of it', () => {
    expect(unquoted('"Field Notes"')).toBe('Field Notes')
    expect(unquoted("'Field Notes'")).toBe('Field Notes')
    expect(unquoted('  "Field Notes"  ')).toBe('Field Notes')
  })

  test('keeps quotes that are part of what it says', () => {
    expect(unquoted('a "quoted" word')).toBe('a "quoted" word')
    expect(unquoted('"opened but not closed')).toBe('"opened but not closed')
    expect(unquoted('"')).toBe('"')
    expect(unquoted('"a\'')).toBe('"a\'')
  })

  test('and is trimmed either way', () => {
    expect(unquoted('  plain  ')).toBe('plain')
    expect(unquoted('""')).toBe('')
  })
})

describe('a flow sequence', () => {
  test('reads as its items, quotes off and blanks gone', () => {
    expect(flowItems('[one, two]')).toEqual(['one', 'two'])
    expect(flowItems('[ "one" , two ]')).toEqual(['one', 'two'])
    expect(flowItems('  [one]  ')).toEqual(['one'])
  })

  test('an empty one is a list of nothing, not nothing', () => {
    expect(flowItems('[]')).toEqual([])
    expect(flowItems('[  ]')).toEqual([])
  })

  test('and anything that is not one is nothing', () => {
    expect(flowItems('one, two')).toBeNull()
    expect(flowItems('[one')).toBeNull()
    expect(flowItems('')).toBeNull()
  })
})

describe('a list item', () => {
  test('at the key’s own margin as well as under it', () => {
    expect(listItem('- One')).toBe('One')
    expect(listItem('  - One')).toBe('One')
    expect(listItem('\t- One')).toBe('One')
  })

  test('with the quotes off and the blanks gone', () => {
    expect(listItem('  -   "One"  ')).toBe('One')
  })

  test('a dash with nothing after it is an item of nothing', () => {
    expect(listItem('-')).toBe('')
    expect(listItem('  -  ')).toBe('')
  })

  test('a dash stuck to the word is part of the word, not an item', () => {
    expect(listItem('-One')).toBeNull()
    expect(listItem('-2')).toBeNull()
  })

  test('and a line that is not a list item at all is nothing', () => {
    expect(listItem('key: value')).toBeNull()
    expect(listItem('')).toBeNull()
  })
})
