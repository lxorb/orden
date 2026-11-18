import { describe, expect, test } from 'vitest'
import { isEmpty, parseQuery, type Query, type Unit } from './query'

const word = (text: string, fold = true): Query => ({ kind: 'text', text, fold })
const all = (...of: Query[]): Query => ({ kind: 'all', of })
const any = (...of: Query[]): Query => ({ kind: 'any', of })
const not = (of: Query): Query => ({ kind: 'not', of })
const scope = (unit: Unit, of: Query): Query => ({ kind: 'scope', unit, of })
const regex = (source: string, fold = false): Query => ({ kind: 'regex', source, fold })
const field = (kind: 'path' | 'file' | 'content', text: string, fold = true): Query => ({
  kind,
  text,
  fold,
})
type Compare = Extract<Query, { kind: 'property' }>['compare']
const property = (name: string, value: string | null, compare: Compare = 'has', upto?: string) =>
  ({ kind: 'property', name, value, compare, ...(upto === undefined ? {} : { upto }) }) as Query

const READ: Record<string, [string, Query][]> = {
  'bare words': [
    ['alpha beta', all(word('alpha'), word('beta'))],
    ['alpha', word('alpha')],
    ['  alpha \t beta \n ', all(word('alpha'), word('beta'))],
  ],
  quoting: [
    ['"two words"', word('two words')],
    ['"never closed', word('never closed')],
    ['"say \\"hello\\""', word('say "hello"')],
  ],
  escaping: [
    ['two\\ words', word('two words')],
    ['\\-not-excluded', word('-not-excluded')],
    ['a\\\\b', word('a\\b')],
    ['alpha\\', word('alpha\\')],
  ],
  excluding: [
    ['-alpha', not(word('alpha'))],
    ['-"two words"', not(word('two words'))],
    ['-path:drafts/', not(field('path', 'drafts/'))],
    ['-(a b)', not(all(word('a'), word('b')))],
  ],
  OR: [
    ['a OR b', any(word('a'), word('b'))],
    ['a b OR c', any(all(word('a'), word('b')), word('c'))],
    ['a OR b OR c', any(word('a'), word('b'), word('c'))],
    ['a or b', all(word('a'), word('or'), word('b'))],
    ['a OR', word('a')],
    ['OR a', word('a')],
  ],
  nesting: [
    ['(a OR b) c', all(any(word('a'), word('b')), word('c'))],
    ['(a (b OR (c d)))', all(word('a'), any(word('b'), all(word('c'), word('d'))))],
    ['(a b', all(word('a'), word('b'))],
    ['a ) b', all(word('a'), word('b'))],
    ['a )) b )', all(word('a'), word('b'))],
    ['a ()', word('a')],
  ],
  'the fields': [
    ['path:work/2026', field('path', 'work/2026')],
    ['file:Read', field('file', 'Read')],
    ['tag:#work', { kind: 'tag', tag: 'work' }],
    ['tag:work', { kind: 'tag', tag: 'work' }],
    ['content:plan', field('content', 'plan')],
    ['content:"the plan"', field('content', 'the plan')],
    ['case: content:Plan', field('content', 'Plan', false)],
    ['path:"my notes/"', field('path', 'my notes/')],
    ['alpha tag:', word('alpha')],
    ['https://example.com', word('https://example.com')],
  ],
  case: [
    ['Alpha', word('Alpha', true)],
    ['a case: B c', all(word('a'), word('B', false), word('c', false))],
  ],
  'regular expressions': [
    ['/a.c/', regex('a.c')],
    ['/a.c/i', regex('a.c', true)],
    ['/a\\/b/', regex('a\\/b')],
    ['/[/]x/', regex('[/]x')],
    ['/notes/2026', word('/notes/2026')],
    ['/usr/bin', word('/usr/bin')],
    ['/Users/david', word('/Users/david')],
    ['/usr/local/bin', word('/usr/local/bin')],
    ['/dev/null', word('/dev/null')],
    ['/a/ii', word('/a/ii')],
    ['/Plan/i', regex('Plan', true)],
    ['/Plan/gi', regex('Plan', true)],
    ['/usr/bin line:/TODO/', all(word('/usr/bin'), scope('line', regex('TODO')))],
    ['/a/x OR /b/', any(word('/a/x'), regex('b'))],
    ['/notes/2026 line:/TODO/', all(word('/notes/2026'), scope('line', regex('TODO')))],
    ['/tmp/a.txt OR /plan/i', any(word('/tmp/a.txt'), regex('plan', true))],
    ['/help /x/', all(word('/help'), regex('x'))],
    ['/a b/', regex('a b')],
    ['/[/] x/', regex('[/] x')],
    ['/a/b/', regex('a/b')],
    ['/', word('/')],
    ['/^- /', regex('^- ')],
    ['/TODO: / plan', all(regex('TODO: '), word('plan'))],
  ],
  'a word with brackets': [
    ['(f(x) notes)', all(word('f(x)'), word('notes'))],
    ['(print() OR log())', any(word('print()'), word('log()'))],
    ['-case:Plan', not(word('Plan', false))],
    ['task:case:Plan', scope('task', word('Plan', false))],
    ['meeting -case:Plan', all(word('meeting'), not(word('Plan', false)))],
    ['case:)', all()],
    ['print()', word('print()')],
    ['a) OR b', any(word('a)'), word('b'))],
  ],
  nearness: [
    ['line:(a b)', scope('line', all(word('a'), word('b')))],
    ['block:(a b)', scope('block', all(word('a'), word('b')))],
    ['section:(a b)', scope('section', all(word('a'), word('b')))],
    ['line:alpha', scope('line', word('alpha'))],
    ['line:(a -b)', scope('line', all(word('a'), not(word('b'))))],
  ],
  'front matter': [
    ['[status]', property('status', null)],
    ['[status:done]', property('status', 'done')],
    ['[status: done]', property('status', 'done')],
    ['[Status]', property('status', null)],
    ['[status', word('[status')],
    ['[[Meeting]]', word('[[Meeting]]')],
    ['[x] done', all(word('[x]'), word('done'))],
    ['[duration:<5]', property('duration', '5', 'lt')],
    ['[duration:<=5]', property('duration', '5', 'lte')],
    ['[due:>2026-09-01]', property('due', '2026-09-01', 'gt')],
    ['[due:>= 2026-09-01]', property('due', '2026-09-01', 'gte')],
    ['[status:=done]', property('status', 'done', 'is')],
    ['[pages:100..200]', property('pages', '100', 'range', '200')],
    ['[pages:..200]', property('pages', '..200')],
    ['[due:null]', property('due', null, 'null')],
    ['[status:=null]', property('status', 'null', 'is')],
    ['[due:>]', property('due', null)],
  ],
  tasks: [
    ['task:(a b)', scope('task', all(word('a'), word('b')))],
    ['task-todo:plan', scope('task-todo', word('plan'))],
    ['task-done:plan', scope('task-done', word('plan'))],
    ['task-todo:', scope('task-todo', all())],
    ['first-draft:plan', word('first-draft:plan')],
  ],
}

describe.each(Object.entries(READ))('%s', (_, rows) => {
  test.each(rows)('%j reads as asked', (source, query) => {
    expect(parseQuery(source)).toEqual(query)
  })
})

test.each(['', '   ', '""', '-', 'path:', 'content:', 'case:', 'line:()', 'line:'])(
  '%j asks nothing',
  (source) => expect(isEmpty(parseQuery(source))).toBe(true),
)

test('a group closes after an empty scope or a lone minus, and a link is a word', () => {
  expect(parseQuery('(task-todo: OR task-done:) plan').kind).toBe('all')
  expect(parseQuery('(a OR line:) b').kind).toBe('all')
  expect(parseQuery('-(task:) plan').kind).toBe('all')
  expect(parseQuery('[docs](http://x)')).toMatchObject({ kind: 'text' })
})

describe('malformed input', () => {
  const NASTY = [
    ...['"', '((((', '))))', '-', '--', '- -', '\\', '/', '//', '///', '[', ']', '[]', '[:]'],
    ...['path:"', 'tag:#', 'line:', 'line:(', 'task:', 'task-todo:(', 'task-', '[a:<]', '[a:..]'],
    ...['[a:..b]', '[a:>=]', '[a:1..]', 'case:case:case:', 'OR OR OR', 'a OR ) b (', '/(/'],
    ...['/[/', '\0', '   \n\t  '],
  ]

  test.each(NASTY)('never throws on %j, and answers something JSON can carry', (source) => {
    expect(() => JSON.stringify(parseQuery(source))).not.toThrow()
  })
})
