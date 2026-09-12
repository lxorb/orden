import { describe, expect, test } from 'vitest'
import { flowItem, flowItems, listItem, oneLine, scalar, unquoted } from './yaml'

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

describe('a value being written', () => {
  test('is left plain where it reads back as itself', () => {
    expect(scalar('Done')).toBe('Done')
    expect(scalar('2026-01-02')).toBe('2026-01-02')
    expect(scalar('a b c')).toBe('a b c')
    expect(scalar('https://site.example/a?b=1#c')).toBe('https://site.example/a?b=1#c')
  })

  test('is quoted where YAML would read it as something else', () => {
    expect(scalar('yes')).toBe("'yes'")
    expect(scalar('12')).toBe("'12'")
    expect(scalar('one: two')).toBe("'one: two'")
    expect(scalar('# hash')).toBe("'# hash'")
    expect(scalar('- not a list')).toBe("'- not a list'")
    expect(scalar('')).toBe("''")
  })

  test('and comes back out of the reader as what was written', () => {
    // The two writers this replaced each quoted the other's case in a way this
    // package's own reader could not undo: `'It''s'` came back doubled, and
    // `"say \"hi\""` came back with its backslashes.
    for (const value of ['say "hi"', "It's: here", 'plain', 'one: two', '# hash', 'yes']) {
      expect(unquoted(scalar(value)), value).toBe(value)
    }
  })

  test('takes single quotes unless it holds an apostrophe of its own', () => {
    // A quote inside a value is not syntax, so a value needing quotes for another
    // reason keeps it: `'"quoted"'` starts with one and does need them.
    expect(scalar('say "hi": really')).toBe(`'say "hi": really'`)
    expect(scalar('"quoted"')).toBe(`'"quoted"'`)
    expect(scalar("It's: here")).toBe(`"It's: here"`)
  })

  test('is one line, whatever arrived', () => {
    expect(scalar('Fine\n---\n\n<img src=x>')).toBe('Fine --- <img src=x>')
    expect(oneLine('  two\t lines\n here ')).toBe('two lines here')
  })

  test('a member of a flow list also quotes what would end the list', () => {
    expect(flowItem('work')).toBe('work')
    expect(flowItem('a, b')).toBe("'a, b'")
    expect(flowItem('[x]')).toBe("'[x]'")
    expect(flowItems(`[${flowItem('work')}, ${flowItem('two words')}]`)).toEqual([
      'work',
      'two words',
    ])
  })
})
