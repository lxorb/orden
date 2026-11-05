import { describe, expect, test, vi } from 'vitest'
import { cellValue } from '../answer'
import { readBase, writeBase } from '../base-file'
import { BasesError } from '../errors'
import { contextAt, noteRow } from '../fixtures/rows'
import type { Base, Row, Value } from '../types'
import { compile } from './compile'
import { patternAllowed, refusedPattern } from './pattern'

const context = contextAt()
const book = noteRow(
  'Books/Dune.md',
  {
    price: 12.5,
    age: 5,
    status: 'reading',
    'my prop': 'spaced',
    categories: [{ kind: 'link', target: 'Books' }],
    author: { kind: 'link', target: 'Frank Herbert' },
    tags: ['sf'],
    meta: { pages: 412 },
  },
  { tags: ['book/sf', 'classic'], links: ['Textbook', 'Frank Herbert'] },
)

const run = (
  source: string,
  row: Row | null = book,
  formulas: Record<string, string> = {},
): Value => compile(source).evaluate(row, context, formulas)

/** Bases' functions page, every example with the answer it documents. */
const DOCUMENTED: [string, Value][] = [
  ['"hello".contains("ell")', true],
  ['"hello".containsAll("h", "e")', true],
  ['"hello".containsAny("x", "y", "e")', true],
  ['"hello".endsWith("lo")', true],
  ['"Hello world".isEmpty()', false],
  ['"".isEmpty()', true],
  ['"a:b:c:d".replace(/:/, "-")', 'a-b:c:d'],
  ['"a:b:c:d".replace(/:/g, "-")', 'a-b-c-d'],
  ['"a:b:c:d".replace(":", "-")', 'a-b-c-d'],
  ['"John Smith".replace(/(\\w+) (\\w+)/, "$2, $1")', 'Smith, John'],
  ['"123".repeat(2)', '123123'],
  ['"hello".reverse()', 'olleh'],
  ['"hello".slice(1, 4)', 'ell'],
  ['"a,b,c,d".split(",", 3)', ['a', 'b', 'c']],
  ['"a,b,c,d".split(/,/, 3)', ['a', 'b', 'c']],
  ['"hello".startsWith("he")', true],
  ['"hello world".title()', 'Hello World'],
  ['"  hi  ".trim()', 'hi'],
  ['"hello".lower()', 'hello'],
  ['"hello".length', 5],
  ['(-5).abs()', 5],
  ['(2.1).ceil()', 3],
  ['(2.9).floor()', 2],
  ['5.isEmpty()', false],
  ['0.isEmpty()', false],
  ['false.isEmpty()', false],
  ['(2.5).round()', 3],
  ['(2.3333).round(2)', 2.33],
  ['(3.14159).toFixed(2)', '3.14'],
  ['[1,2,3].contains(2)', true],
  ['[1,2,3].containsAll(2,3)', true],
  ['[1,2,3].containsAny(3,4)', true],
  ['[1,2,3,4].filter(value > 2)', [3, 4]],
  ['[1,[2,3]].flat()', [1, 2, 3]],
  ['[1,2,3].isEmpty()', false],
  ['[1,2,3].join(",")', '1,2,3'],
  ['[1,2,3,4].map(value + 1)', [2, 3, 4, 5]],
  ['[1,2,3].reduce(acc + value, 0)', 6],
  [
    '[3, 7, "x", 2].filter(value.isType("number")).reduce(if(acc == null || value > acc, value, acc), null)',
    7,
  ],
  ['[1,2,3].reverse()', [3, 2, 1]],
  ['[1,2,3,4].slice(1,3)', [2, 3]],
  ['[3, 1, 2].sort()', [1, 2, 3]],
  ['["c", "a", "b"].sort()', ['a', 'b', 'c']],
  ['[1,2,2,3].unique()', [1, 2, 3]],
  ['[1,2,3].length', 3],
  ['["a","b"].map(value + index)', ['a0', 'b1']],
  ['1.isTruthy()', true],
  ['"example".isType("string")', true],
  ['true.isType("boolean")', true],
  ['123.toString()', '123'],
  ['{}.isEmpty()', true],
  ['{"a": 1, "b": 2}.keys()', ['a', 'b']],
  ['{"a": 1, "b": 2}.values()', [1, 2]],
  ['/abc/.matches("abcde")', true],
  ['date("2025-05-27").format("YYYY-MM-DD")', '2025-05-27'],
  ['now().date().format("YYYY-MM-DD HH:mm:ss")', '2026-10-04 00:00:00'],
  ['now().time()', '10:00:00'],
  [
    'date("2024-12-01") + "1M" + "4h" + "3m"',
    { kind: 'date', iso: '2025-01-01', time: '04:03:00' },
  ],
  ['number((now() + "1d") - now())', 86_400_000],
  ['(now() + "1d") - now()', { kind: 'duration', ms: 86_400_000, months: 0 }],
  ['now() + "1 day"', { kind: 'date', iso: '2026-10-05', time: '10:00:00' }],
  ['today() + "7d"', { kind: 'date', iso: '2026-10-11' }],
  ['today() - "1w"', { kind: 'date', iso: '2026-09-27' }],
  ['date("2026-01-31") + "1M"', { kind: 'date', iso: '2026-02-28' }],
  ['date("2024-02-29") + "1y"', { kind: 'date', iso: '2025-02-28' }],
  ['now() + (duration("1d") * 2)', { kind: 'date', iso: '2026-10-06', time: '10:00:00' }],
  ['(today() - date("2026-09-01")).days', 33],
  ['date("2026-10-01").relative()', '3 days ago'],
  ['date("2026-10-04 12:00:00").relative()', 'in 2 hours'],
  ['date("2025-05-27 14:05:09").year', 2025],
  ['date("2025-05-27 14:05:09").month', 5],
  ['date("2025-05-27 14:05:09").day', 27],
  ['date("2025-05-27 14:05:09").hour', 14],
  ['date("2025-05-27 14:05:09").minute', 5],
  ['date("2025-05-27 14:05:09").second', 9],
  ['date("2025-05-27").format("dddd, MMMM Do YYYY")', 'Tuesday, May 27th 2025'],
  ['date("2025-05-27 14:05").format("h:mm A [on] ddd")', '2:05 PM on Tue'],
  ['date("2025-05-27").isEmpty()', false],
  ['if(true, "a", "b")', 'a'],
  ['if(false, "a")', null],
  ['if(0, "a", "b")', 'b'],
  ['list("value")', ['value']],
  ['list([1])', [1]],
  ['max(1, 5, 3)', 5],
  ['min(1, 5, 3)', 1],
  ['number("3.4")', 3.4],
  ['number(true)', 1],
  ['number(date("1970-01-02"))', 86_400_000],
  ['escapeHTML("<b>\\"x\\"</b>")', '&lt;b&gt;&quot;x&quot;&lt;/b&gt;'],
  ['link("filename", "display")', { kind: 'link', target: 'filename', display: 'display' }],
  ['link("[[Notes/Idea]]")', { kind: 'link', target: 'Notes/Idea' }],
  ['icon("arrow-right")', { kind: 'icon', name: 'arrow-right' }],
  ['image("https://obsidian.md/logo.svg")', { kind: 'image', src: 'https://obsidian.md/logo.svg' }],
  ['html("<b>x</b>")', { kind: 'html', html: '<b>x</b>' }],
  ['duration("5h") * 2', { kind: 'duration', ms: 36_000_000, months: 0 }],
  ['today()', { kind: 'date', iso: '2026-10-04' }],
]

describe('every documented function', () => {
  test.each(DOCUMENTED)('%s', (source, expected) => {
    expect(run(source)).toEqual(expected)
  })
})

describe('the operators', () => {
  test.each<[string, Value]>([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['7 % 3', 1],
    ['10 / 4', 2.5],
    ['-(2) + 1', -1],
    ['!false && true', true],
    ['false || "fallback"', 'fallback'],
    ['2 > 1 == true', true],
    ['"a" + 1', 'a1'],
    ['1 == "1"', false],
    ['null == null', true],
    ['null > 1', false],
    ['null < 1', false],
    ['[1, 2] + [3]', [1, 2, 3]],
    ['date("2026-10-04") == "2026-10-04"', true],
    ['date("2026-10-04") < date("2026-10-05")', true],
    ['date("2026-10-04") > "2026-10-01"', true],
    ['link("Books") == "books"', true],
    ['"it\'s"', "it's"],
    ['\'say "hi"\'', 'say "hi"'],
  ])('%s', (source, expected) => {
    expect(run(source)).toEqual(expected)
  })
})

describe('properties', () => {
  test.each<[string, Value]>([
    ['price', 12.5],
    ['note.price', 12.5],
    ['note["price"]', 12.5],
    ['note["my prop"]', 'spaced'],
    ['meta.pages', 412],
    ['meta["pages"]', 412],
    ['missing', null],
    ['missing.isEmpty()', true],
    ['missing.contains("x")', null],
    ['file.name', 'Dune.md'],
    ['file.basename', 'Dune'],
    ['file.ext', 'md'],
    ['file.folder', 'Books'],
    ['file.path', 'Books/Dune.md'],
    ['file.size', 100],
    ['file.ctime', { kind: 'date', iso: '2026-01-01', time: '00:00:00' }],
    ['file.mtime.date()', { kind: 'date', iso: '2026-10-01' }],
    ['file.tags', ['book/sf', 'classic']],
    ['file.hasTag("book")', true],
    ['file.hasTag("#classic")', true],
    ['file.hasTag("bo")', false],
    ['file.hasTag("x", "classic")', true],
    ['file.inFolder("Books")', true],
    ['file.inFolder("Boo")', false],
    ['file.hasLink("Textbook")', true],
    ['file.hasLink("Other")', false],
    ['file.hasProperty("price")', true],
    ['file.hasProperty("nope")', false],
    ['file.asLink()', { kind: 'link', target: 'Books/Dune.md' }],
    ['file.properties.status', 'reading'],
    ['file.links[0]', { kind: 'link', target: 'Textbook' }],
    ['categories.contains(link("Books"))', true],
    ['author == link("Frank Herbert")', true],
    ['list(tags).contains("sf")', true],
    ['file.embeds[0].containsAny("jpg", "png")', null],
    ['file.file.name', 'Dune.md'],
    ['file.space', 'Notes'],
  ])('%s', (source, expected) => {
    expect(run(source)).toEqual(expected)
  })
})

describe('formulas', () => {
  const formulas = {
    ppu: '(price / age).toFixed(2)',
    formatted_price: 'if(price, price.toFixed(2) + " dollars")',
    twice: 'number(formula.ppu) * 2',
    loop: 'formula.loop + 1',
  }

  test('read each other, as the help page writes them', () => {
    expect(run('formula.ppu', book, formulas)).toBe('2.50')
    expect(run('formula.formatted_price', book, formulas)).toBe('12.50 dollars')
    expect(run('formula.twice', book, formulas)).toBe(5)
  })

  test('a formula that reaches itself is an error, not a loop', () => {
    expect(() => run('formula.loop', book, formulas)).toThrow(BasesError)
  })

  test('a formula nobody wrote is nothing', () => {
    expect(run('formula.nope', book, formulas)).toBeNull()
  })
})

describe('this', () => {
  const author = noteRow('People/Frank Herbert.md', { born: 1920, related: ['x'] })
  const resolve = (target: string) =>
    target === 'Frank Herbert' ? 'People/Frank Herbert.md' : null
  const withThis = { ...context, this: author, resolve }

  test('is the embedding note: its file, its properties, a link to it', () => {
    expect(compile('this.file.name').evaluate(book, withThis)).toBe('Frank Herbert.md')
    expect(compile('this.born').evaluate(book, withThis)).toBe(1920)
    expect(compile('author == this').evaluate(book, withThis)).toBe(true)
    expect(compile('list(author).contains(this)').evaluate(book, withThis)).toBe(true)
    expect(compile('file.hasLink(this)').evaluate(book, withThis)).toBe(true)
    expect(compile('file.hasLink(this.file)').evaluate(book, withThis)).toBe(true)
  })

  test('is nothing where nothing embeds the base', () => {
    expect(run('this')).toBeNull()
    expect(run('this.file.name')).toBeNull()
  })

  test('a link reaches the file it points at', () => {
    const lookup = {
      ...withThis,
      row: (path: string) => (path === author.path ? author : undefined),
    }
    expect(compile('author.asFile().properties.born').evaluate(book, lookup)).toBe(1920)
    expect(compile('file(author).file.name').evaluate(book, lookup)).toBe('Frank Herbert.md')
    expect(compile('author.asFile().properties.born').local).toBe(false)
    expect(compile('note.price').local).toBe(true)
  })
})

describe('mistakes', () => {
  test.each([
    ['price +', 'The expression ends too soon'],
    ['(price', 'Expected ")" at the end'],
    ['price price', 'Unexpected "price"'],
    ['nope(1)', 'There is no function nope()'],
    ['"unclosed', 'A string is not closed'],
    ['', 'The expression is empty'],
  ])('%s says "%s"', (source, message) => {
    expect(() => compile(source)).toThrow(message)
  })

  test('say where', () => {
    try {
      compile('price + * 2')
    } catch (error) {
      expect(error).toBeInstanceOf(BasesError)
      expect((error as BasesError).at).toBe(8)
    }
  })

  test('a method a value does not have is an error when run', () => {
    expect(() => run('(5).lower()')).toThrow('number has no lower()')
    expect(() => run('number("abc")')).toThrow(BasesError)
  })
})

describe('what Object.prototype holds is no property', () => {
  test.each([
    'note.constructor',
    'note.toString',
    'note.__proto__',
    'note["constructor"]',
    'constructor',
    'this.constructor',
    'formula.constructor',
    'note.meta.constructor',
  ])('%s is null', (source) => {
    expect(run(source)).toBeNull()
  })

  test('file.hasProperty asks the note and nothing behind it', () => {
    expect(run('file.hasProperty("toString")')).toBe(false)
    expect(run('file.hasProperty("__proto__")')).toBe(false)
    expect(run('file.hasProperty("status")')).toBe(true)
  })
})

describe('a pattern in a base of ones own', () => {
  test.each([
    ['/^[a-z]+(-[a-z]+)*$/.matches("a-b-c")', true],
    ['/^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$/.matches("a@b.co")', true],
    ['/^(\\w+\\/)+/.matches("a/b/")', true],
    ['/^#(\\w+\\/)*\\w+$/.matches("#a/b")', true],
    ['/^(foo|far)+$/.matches("foofar")', true],
    ['/(\\w)\\1/.matches("aa")', true],
    ['/^\\s*(\\w+)\\s*:\\s*(.*)$/.matches("key : with a long value after it, past twenty")', true],
    ['/.*foo.*bar.*baz.*/.matches("foo bar baz")', true],
    ['"a1b".replace(/\\d+/, "x")', 'axb'],
    ['"a,b".split(/,/)', ['a', 'b']],
  ] as [string, Value][])('%s answers as it always did', (source, wanted) => {
    expect(run(source)).toEqual(wanted)
  })

  test('a long value is read like a short one', () => {
    const wide = 'x'.repeat(5000)
    expect(run(`/\\d+(\\.\\d+)?|x/.matches("${wide}")`)).toBe(true)
  })
})

describe('a pattern in a base somebody else could have written', () => {
  const safe = (source: string) => patternAllowed(new RegExp(source))

  test.each([
    /(a+)+$/,
    /(a*)*$/,
    /(a|a)+$/,
    /(a|ab)*c/,
    /(\w|\d)+$/,
    /(a?)+$/,
    /(?:a+)+$/,
    /(a{1,5})+$/,
    /((a+))+$/,
    /(a+b?)*$/,
    /(a*)\1$/,
    /(?<x>a*)\k<x>$/,
    /(a+){20}$/,
    /^(\u{61}+)+$/u,
    /^(σ|ς)+$/i,
    /^(µ|μ)+$/i,
    /^(ſ|s)+$/iu,
    /^(K|K)+$/iu,
    /^(\x61|a)+$/,
    /^(a|a)+$/,
    /^(\u{61}|a)+$/u,
    /^(?:\p{L}+)+$/u,
    new RegExp(`${'a?'.repeat(30)}${'a'.repeat(30)}`),
    new RegExp('(a|a)'.repeat(30)),
    new RegExp(`${'.*'.repeat(30)}x`),
  ])('%s is refused, measured and not run', (pattern) => {
    expect(patternAllowed(pattern)).toBe(false)
  })

  test.each([
    '^abc$',
    '^(foo|bar)+$',
    '^\\d{4}-\\d{2}-\\d{2}$',
    '^(\\d{2})+$',
    '(\\.\\d+)?$',
    '[(a+)+]',
    '\\(a+\\)+',
    '^(a|b)*$',
    '\\d+-\\d+',
  ])('/%s/ may run', (source) => {
    expect(safe(source)).toBe(true)
  })

  test('a counted repeat that is not one is read as what it is', () => {
    expect(patternAllowed(new RegExp('^(\\u{61})+$'))).toBe(true)
    expect(patternAllowed(/^\p{L}+$/u)).toBe(true)
  })

  const guardedBase = (formula: string) =>
    ({
      ...readBase(
        `formulas:\n  f: ${JSON.stringify(formula)}\nviews:\n  - type: table\n    name: T\n`,
      ),
      guarded: true,
    }) as Base

  test('names the pattern that is refused, wherever in the base it is written', () => {
    expect(refusedPattern(guardedBase('/(a+)+$/.matches("x")'))).toBe('/(a+)+$/')
    expect(
      refusedPattern(
        readBase(
          'views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - /(a|a)*/.matches(note.x)\n',
        ),
      ),
    ).toBe('/(a|a)*/')
    expect(refusedPattern(guardedBase('/^(foo|bar)+$/.matches("x")'))).toBeNull()
    expect(refusedPattern(readBase('views:\n  - type: table\n    name: T\n'))).toBeNull()
  })

  test('a guarded base refuses a value too long to read rather than start on it', () => {
    const base = guardedBase('/x$/.matches(note.long)')
    const row = noteRow('A.md', { long: 'x'.repeat(2000), short: 'x' })
    expect(cellValue(base, 'formula.f', row, context)).toBeNull()
    expect(
      cellValue(
        { ...base, formulas: { f: '/x$/.matches(note.short)' } },
        'formula.f',
        row,
        context,
      ),
    ).toBe(true)
    expect(cellValue({ ...base, guarded: false }, 'formula.f', row, context)).toBe(true)
  })

  test('a guarded base spends a share of the clock on patterns and no more', () => {
    let now = 0
    let step = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += step))
    const base = guardedBase('"x".replace(/x/, note.y)')
    const row = noteRow('A.md', { y: 'z' })
    try {
      expect(cellValue(base, 'formula.f', row, context)).toBe('z')
      now += 1000
      step = 400
      expect(cellValue(base, 'formula.f', row, context)).toBe('z')
      step = 0
      expect(cellValue(base, 'formula.f', row, context)).toBeNull()
      now += 1000
      expect(cellValue(base, 'formula.f', row, context)).toBe('z')
    } finally {
      clock.mockRestore()
    }
  })

  test('the flag is no part of the file', () => {
    const base = readBase('views:\n  - type: table\n    name: T\n')
    expect(writeBase({ ...base, guarded: true })).toBe(writeBase(base))
  })
})
