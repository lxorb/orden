import { describe, expect, test } from 'vitest'
import { Matcher } from './match'
import { parseQuery } from './query'
import { expand, replaceIn } from './replace'

/** What the panel does to one note: find, keep the lines that are ticked,
 *  and put the replacement in. */
function rewrite(body: string, query: string, replacement: string, lines?: number[]) {
  const spans = new Matcher(parseQuery(query)).spans({
    path: '/space/Note.md',
    relative: 'Note.md',
    name: 'Note.md',
    body,
  })

  if (!spans) return null

  const kept = new Set(lines ?? body.split('\n').map((_line, index) => index))
  return replaceIn(body, spans, kept, replacement)
}

describe('replacing', () => {
  test('puts the new words in every match', () => {
    expect(rewrite('alpha and alpha\n', 'alpha', 'beta')?.text).toBe('beta and beta\n')
  })

  test('leaves the lines nobody ticked alone', () => {
    const body = 'alpha one\nalpha two\nalpha three\n'
    expect(rewrite(body, 'alpha', 'beta', [1])?.text).toBe('alpha one\nbeta two\nalpha three\n')
  })

  test('answers nothing when no ticked line matched', () => {
    expect(rewrite('alpha\nbeta\n', 'alpha', 'gamma', [1])).toBeNull()
  })

  test('keeps the case that was typed, whatever case was found', () => {
    expect(rewrite('Alpha and ALPHA\n', 'alpha', 'beta')?.text).toBe('beta and beta\n')
  })

  test('replaces words two operators both found only once', () => {
    expect(rewrite('alphabet\n', 'alpha alphabet', 'x')?.text).toBe('x\n')
  })

  test('says which edits it made, so a pane can take them as edits', () => {
    expect(rewrite('a alpha b\n', 'alpha', 'beta')?.edits).toEqual([
      { from: 2, to: 7, insert: 'beta' },
    ])
  })

  test('takes the words out when the replacement is empty', () => {
    expect(rewrite('alpha beta\n', '"alpha "', '')?.text).toBe('beta\n')
  })
})

describe('groups', () => {
  test('put back what the pattern caught', () => {
    expect(rewrite('Doe, John\n', '/(\\w+), (\\w+)/', '$2 $1')?.text).toBe('John Doe\n')
  })

  test('put back the whole match for $&', () => {
    expect(rewrite('alpha\n', '/al\\w+/', '[$&]')?.text).toBe('[alpha]\n')
  })

  test('take $$ as one dollar', () => {
    expect(rewrite('alpha\n', '/alpha/', '$$1')?.text).toBe('$1\n')
  })

  test('leave a group the pattern never had alone', () => {
    expect(rewrite('alpha\n', '/alpha/', '$3')?.text).toBe('$3\n')
  })

  test('do not read a plain word as a pattern with groups', () => {
    expect(rewrite('alpha\n', 'alpha', '$1')?.text).toBe('$1\n')
  })

  test('run down a whole note', () => {
    const body = 'a-1\nb-2\n'
    expect(rewrite(body, '/(\\w)-(\\d)/', '$2$1')?.text).toBe('1a\n2b\n')
  })
})

describe('expanding a replacement', () => {
  test('hands a plain one back untouched', () => {
    expect(expand('$1 and $&', 'matched', undefined)).toBe('$1 and $&')
  })

  test('fills what the pattern caught', () => {
    expect(expand('$1-$2', 'ab', ['a', 'b'])).toBe('a-b')
  })

  test('reads a group that took part in no match as nothing', () => {
    expect(expand('[$1]', 'x', [''])).toBe('[]')
  })
})
