import { describe, expect, test } from 'vitest'
import { backtracksWildly } from './pattern-cost'

describe('a pattern that could backtrack without end', () => {
  test.each([
    '(a+)+b',
    '(a*)*$',
    '(a|a)+$',
    '(a|ab)*c',
    '(\\w+\\s?)+$',
    '((a+))+$',
    '(?:a+)+$',
    '(a[ab]+)+$',
    '(\\s*\\w+)*$',
    '(a|aa)+$',
    '(a|a)'.repeat(30),
    '('.repeat(5000) + 'a' + ')'.repeat(5000),
  ])('/%s/ is told apart before it runs', (source) => {
    expect(backtracksWildly(source)).toBe(true)
  })

  test.each([
    'foo',
    'w[a-z]+d',
    '.*x',
    '^(foo|bar)+$',
    '\\d{4}-\\d{2}-\\d{2}',
    '\\b(\\w+) \\1\\b',
    '(?<x>a)\\k<x>',
    '[(a+)+]',
    '\\(a+\\)+',
    '^[a-z]+(-[a-z]+)*$',
    '^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$',
    '^(\\w+\\/)+',
    '^#(\\w+\\/)*\\w+$',
    '^(foo|far)+$',
    '(\\d+,)*\\d+',
  ])('/%s/ may run', (source) => {
    expect(backtracksWildly(source)).toBe(false)
  })
})
