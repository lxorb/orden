import { describe, expect, test } from 'vitest'
import { isEmpty, parseQuery, type Query } from './query'

/** The parser's answers are compared whole, so a term that quietly grew a
 *  field would fail rather than pass. */
const word = (text: string, fold = true): Query => ({ kind: 'text', text, fold })

describe('bare words', () => {
  test('are one term each, all of which must match', () => {
    expect(parseQuery('alpha beta')).toEqual({ kind: 'all', of: [word('alpha'), word('beta')] })
  })

  test('collapse to the term itself when there is only one', () => {
    expect(parseQuery('alpha')).toEqual(word('alpha'))
  })

  test('ignore whatever whitespace is between them', () => {
    expect(parseQuery('  alpha \t beta \n ')).toEqual({
      kind: 'all',
      of: [word('alpha'), word('beta')],
    })
  })

  test('leave an empty field asking nothing', () => {
    expect(isEmpty(parseQuery(''))).toBe(true)
    expect(isEmpty(parseQuery('   '))).toBe(true)
  })
})

describe('quoting', () => {
  test('keeps a phrase together', () => {
    expect(parseQuery('"two words"')).toEqual(word('two words'))
  })

  test('takes the rest of the query when the quote is never closed', () => {
    expect(parseQuery('"never closed')).toEqual(word('never closed'))
  })

  test('reads an escaped quote as a quote', () => {
    expect(parseQuery('"say \\"hello\\""')).toEqual(word('say "hello"'))
  })

  test('keeps an empty phrase out of the query', () => {
    expect(isEmpty(parseQuery('""'))).toBe(true)
  })
})

describe('escaping', () => {
  test('keeps a space inside a word', () => {
    expect(parseQuery('two\\ words')).toEqual(word('two words'))
  })

  test('takes a leading dash as a character', () => {
    expect(parseQuery('\\-not-excluded')).toEqual(word('-not-excluded'))
  })

  test('takes a backslash as a backslash', () => {
    expect(parseQuery('a\\\\b')).toEqual(word('a\\b'))
  })

  test('leaves a trailing backslash alone', () => {
    expect(parseQuery('alpha\\')).toEqual(word('alpha\\'))
  })
})

describe('excluding', () => {
  test('wraps the term it sits on', () => {
    expect(parseQuery('-alpha')).toEqual({ kind: 'not', of: word('alpha') })
  })

  test('reaches a phrase', () => {
    expect(parseQuery('-"two words"')).toEqual({ kind: 'not', of: word('two words') })
  })

  test('reaches an operator', () => {
    expect(parseQuery('-path:drafts/')).toEqual({
      kind: 'not',
      of: { kind: 'path', text: 'drafts/', fold: true },
    })
  })

  test('reaches a group', () => {
    expect(parseQuery('-(a b)')).toEqual({
      kind: 'not',
      of: { kind: 'all', of: [word('a'), word('b')] },
    })
  })

  test('is a word of its own when it stands alone', () => {
    expect(isEmpty(parseQuery('-'))).toBe(true)
  })
})

describe('OR', () => {
  test('widens two words', () => {
    expect(parseQuery('a OR b')).toEqual({ kind: 'any', of: [word('a'), word('b')] })
  })

  test('binds looser than a space', () => {
    expect(parseQuery('a b OR c')).toEqual({
      kind: 'any',
      of: [{ kind: 'all', of: [word('a'), word('b')] }, word('c')],
    })
  })

  test('chains', () => {
    expect(parseQuery('a OR b OR c')).toEqual({
      kind: 'any',
      of: [word('a'), word('b'), word('c')],
    })
  })

  test('has to be shouted, so the word "or" stays searchable', () => {
    expect(parseQuery('a or b')).toEqual({
      kind: 'all',
      of: [word('a'), word('or'), word('b')],
    })
  })

  test('drops the side that is not there', () => {
    expect(parseQuery('a OR')).toEqual(word('a'))
    expect(parseQuery('OR a')).toEqual(word('a'))
  })
})

describe('nesting', () => {
  test('groups what is inside the brackets', () => {
    expect(parseQuery('(a OR b) c')).toEqual({
      kind: 'all',
      of: [{ kind: 'any', of: [word('a'), word('b')] }, word('c')],
    })
  })

  test('nests as deep as it is written', () => {
    expect(parseQuery('(a (b OR (c d)))')).toEqual({
      kind: 'all',
      of: [
        word('a'),
        { kind: 'any', of: [word('b'), { kind: 'all', of: [word('c'), word('d')] }] },
      ],
    })
  })

  test('closes a bracket nobody closed', () => {
    expect(parseQuery('(a b')).toEqual({ kind: 'all', of: [word('a'), word('b')] })
  })

  test('drops a bracket nobody opened', () => {
    expect(parseQuery('a) b')).toEqual({ kind: 'all', of: [word('a'), word('b')] })
  })

  test('leaves an empty group out', () => {
    expect(parseQuery('a ()')).toEqual(word('a'))
  })
})

describe('the fields', () => {
  test('read a path', () => {
    expect(parseQuery('path:work/2026')).toEqual({
      kind: 'path',
      text: 'work/2026',
      fold: true,
    })
  })

  test('read a note name', () => {
    expect(parseQuery('file:Read')).toEqual({ kind: 'file', text: 'Read', fold: true })
  })

  test('read a tag with or without its hash', () => {
    expect(parseQuery('tag:#work')).toEqual({ kind: 'tag', tag: 'work' })
    expect(parseQuery('tag:work')).toEqual({ kind: 'tag', tag: 'work' })
  })

  test('take a quoted value, so a folder may hold a space', () => {
    expect(parseQuery('path:"my notes/"')).toEqual({
      kind: 'path',
      text: 'my notes/',
      fold: true,
    })
  })

  test('are dropped while their value is still being typed', () => {
    expect(isEmpty(parseQuery('path:'))).toBe(true)
    expect(parseQuery('alpha tag:')).toEqual(word('alpha'))
  })

  test('leave a word that only looks like one alone', () => {
    expect(parseQuery('https://example.com')).toEqual(word('https://example.com'))
  })
})

describe('case', () => {
  test('folds by default', () => {
    expect(parseQuery('Alpha')).toEqual(word('Alpha', true))
  })

  test('stops folding for every term after it', () => {
    expect(parseQuery('a case: B c')).toEqual({
      kind: 'all',
      of: [word('a'), word('B', false), word('c', false)],
    })
  })

  test('is not a term of its own', () => {
    expect(isEmpty(parseQuery('case:'))).toBe(true)
  })
})

describe('regular expressions', () => {
  test('read what is between the slashes', () => {
    expect(parseQuery('/a.c/')).toEqual({ kind: 'regex', source: 'a.c', fold: false })
  })

  test('fold only when the i flag says so', () => {
    expect(parseQuery('/a.c/i')).toEqual({ kind: 'regex', source: 'a.c', fold: true })
  })

  test('keep an escaped slash inside the pattern', () => {
    expect(parseQuery('/a\\/b/')).toEqual({ kind: 'regex', source: 'a\\/b', fold: false })
  })

  test('let a slash inside a class stay one', () => {
    expect(parseQuery('/[/]x/')).toEqual({ kind: 'regex', source: '[/]x', fold: false })
  })

  test('are an ordinary word when nothing closes them', () => {
    expect(parseQuery('/notes/2026')).toEqual(word('/notes/2026'))
  })

  test('close at the slash that ends the word', () => {
    expect(parseQuery('/a/b/')).toEqual({ kind: 'regex', source: 'a/b', fold: false })
  })

  test('are an ordinary word when the query is only a slash', () => {
    expect(parseQuery('/')).toEqual(word('/'))
  })
})

describe('nearness', () => {
  test('holds terms to one line', () => {
    expect(parseQuery('line:(a b)')).toEqual({
      kind: 'scope',
      unit: 'line',
      of: { kind: 'all', of: [word('a'), word('b')] },
    })
  })

  test('holds terms to one paragraph', () => {
    expect(parseQuery('block:(a b)')).toEqual({
      kind: 'scope',
      unit: 'block',
      of: { kind: 'all', of: [word('a'), word('b')] },
    })
  })

  test('holds terms to one heading section', () => {
    expect(parseQuery('section:(a b)')).toEqual({
      kind: 'scope',
      unit: 'section',
      of: { kind: 'all', of: [word('a'), word('b')] },
    })
  })

  test('takes a single term without brackets', () => {
    expect(parseQuery('line:alpha')).toEqual({
      kind: 'scope',
      unit: 'line',
      of: word('alpha'),
    })
  })

  test('nests other operators inside itself', () => {
    expect(parseQuery('line:(a -b)')).toEqual({
      kind: 'scope',
      unit: 'line',
      of: { kind: 'all', of: [word('a'), { kind: 'not', of: word('b') }] },
    })
  })

  test('is dropped when the brackets hold nothing', () => {
    expect(isEmpty(parseQuery('line:()'))).toBe(true)
  })
})

describe('front matter', () => {
  test('asks whether the key is there', () => {
    expect(parseQuery('[status]')).toEqual({ kind: 'property', name: 'status', value: null })
  })

  test('asks what the value says', () => {
    expect(parseQuery('[status:done]')).toEqual({
      kind: 'property',
      name: 'status',
      value: 'done',
    })
  })

  test('takes the space after the colon as writing, not as value', () => {
    expect(parseQuery('[status: done]')).toEqual({
      kind: 'property',
      name: 'status',
      value: 'done',
    })
  })

  test('folds the key, because front matter keys are not shouted', () => {
    expect(parseQuery('[Status]')).toEqual({ kind: 'property', name: 'status', value: null })
  })

  test('is an ordinary word when the bracket never closes', () => {
    expect(parseQuery('[status')).toEqual(word('[status'))
  })
})

describe('malformed input', () => {
  const NASTY = [
    '"',
    '((((',
    '))))',
    '-',
    '--',
    '- -',
    '\\',
    '/',
    '//',
    '///',
    '[',
    ']',
    '[]',
    '[:]',
    'path:"',
    'tag:#',
    'line:',
    'line:(',
    'case:case:case:',
    'OR OR OR',
    'a OR ) b (',
    '/(/',
    '/[/',
    ' ',
    '   \n\t  ',
  ]

  test.each(NASTY)('never throws on %j', (source) => {
    expect(() => parseQuery(source)).not.toThrow()
  })

  test('answers something JSON can carry, whatever it was given', () => {
    for (const source of NASTY) {
      expect(() => JSON.stringify(parseQuery(source))).not.toThrow()
    }
  })
})
