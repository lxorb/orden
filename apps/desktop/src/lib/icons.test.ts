import { describe, expect, test } from 'vitest'
import { type IconNode, initial, search, shapeFor, words } from './icons'

const NAMES = [
  'Book',
  'BookOpen',
  'BookmarkMinus',
  'Bookmark',
  'Briefcase',
  'Building2',
  'Calendar',
  'CalendarDays',
  'Laptop',
  'NotebookPen',
  'Notebook',
  'Star',
  'Sparkles',
  'GraduationCap',
]

describe('turning a name into words', () => {
  test('splits the humps', () => {
    expect(words('BookOpen')).toBe('book open')
    expect(words('CalendarDays')).toBe('calendar days')
  })

  test('keeps a run of capitals together', () => {
    expect(words('RSSFeed')).toBe('rss feed')
  })

  test('leaves a digit attached to its word', () => {
    expect(words('Building2')).toBe('building2')
  })
})

describe('searching the library', () => {
  test('puts the exact name first', () => {
    expect(search(NAMES, 'book')[0]).toBe('Book')
    expect(search(NAMES, 'star')[0]).toBe('Star')
  })

  test('finds the multi-word ones too', () => {
    expect(search(NAMES, 'book')).toContain('BookOpen')
    expect(search(NAMES, 'book open')[0]).toBe('BookOpen')
  })

  test('ranks a whole word above a fragment', () => {
    const found = search(NAMES, 'book')
    expect(found.indexOf('BookOpen')).toBeLessThan(found.indexOf('BookmarkMinus'))
  })

  test('understands words that are not icon names', () => {
    expect(search(NAMES, 'work')).toContain('Briefcase')
    expect(search(NAMES, 'uni')).toContain('GraduationCap')
    expect(search(NAMES, 'journal')).toContain('NotebookPen')
  })

  test('is not case sensitive', () => {
    expect(search(NAMES, 'BOOK')[0]).toBe('Book')
  })

  test('gives back the whole set for an empty query', () => {
    expect(search(NAMES, '  ').length).toBe(NAMES.length)
  })

  test('gives back nothing for a query that matches nothing', () => {
    expect(search(NAMES, 'zzzzz')).toEqual([])
  })

  test('honours the limit', () => {
    expect(search(NAMES, '', 3).length).toBe(3)
  })
})

/** What a space in the rail actually draws.
 *
 *  Emil, on his phone: *"I don't see the icons of the spaces on the Even Realities
 *  plugin right now."* The cause was elsewhere - the storage the chosen name is read
 *  from; see lib/even/first.ts - but the rule the rail follows is here, and the half
 *  of it that matters is the last test: a space always shows something.
 */
describe('the mark a space wears', () => {
  const CAP: IconNode = [['path', { d: 'M21 10l-9-4-9 4 9 4z' }]]
  const library: Record<string, IconNode> = { GraduationCap: CAP }

  test('is the shape it chose', () => {
    expect(shapeFor(library, 'GraduationCap')).toBe(CAP)
  })

  test('and its initial where it chose none', () => {
    expect(shapeFor(library, null)).toBeNull()
    expect(initial('Uni')).toBe('U')
    expect(initial('  notes')).toBe('N')
    expect(initial('ubung')).toBe('U')
  })

  /** Three different things a reader cannot tell apart: no icon, an icon this build
   *  has never heard of, and a library that has not loaded yet. All three draw a
   *  letter, and none of them draws an empty square. */
  test('is never nothing, whatever went wrong', () => {
    expect(shapeFor(library, 'NoSuchIcon')).toBeNull()
    expect(shapeFor({}, 'GraduationCap')).toBeNull()
    expect(initial('   ')).toBe('·')
  })
})
