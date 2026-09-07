import { describe, expect, test } from 'vitest'
import { basename, isMarkdown, join, normalise, parent, safeName, spaceOf, within } from './paths'

describe('normalising a path', () => {
  test('always starts at the root and never ends in a slash', () => {
    expect(normalise('Notes/a.md')).toBe('/Notes/a.md')
    expect(normalise('/Notes/a.md/')).toBe('/Notes/a.md')
    expect(normalise('//Notes//')).toBe('/Notes')
  })

  test('accepts the separator Windows would send', () => {
    expect(normalise('Notes\\a.md')).toBe('/Notes/a.md')
  })

  test('leaves the root itself alone', () => {
    expect(normalise('/')).toBe('/')
    expect(normalise('')).toBe('/')
  })

  test('folds a path down to where it points', () => {
    expect(normalise('/Notes/./a.md')).toBe('/Notes/a.md')
    expect(normalise('/Notes/Work/../assets')).toBe('/Notes/assets')
    expect(normalise('/Notes/Work/2026/../../a.md')).toBe('/Notes/a.md')
  })

  test('stops climbing at the root, which nothing is above', () => {
    expect(normalise('/Notes/../../a.md')).toBe('/a.md')
    expect(normalise('/..')).toBe('/')
  })
})

describe('taking a path apart', () => {
  test('names the last segment', () => {
    expect(basename('/Notes/a.md')).toBe('a.md')
    expect(basename('/Notes')).toBe('Notes')
  })

  test('names the folder above', () => {
    expect(parent('/Notes/deep/a.md')).toBe('/Notes/deep')
    expect(parent('/Notes')).toBe('/')
  })

  test('joins without doubling separators', () => {
    expect(join('/Notes', 'a.md')).toBe('/Notes/a.md')
    expect(join('/Notes/', '/a.md')).toBe('/Notes/a.md')
  })

  test('names the space a note belongs to', () => {
    expect(spaceOf('/Notes/deep/a.md')).toBe('/Notes')
    expect(spaceOf('/a.md')).toBe('/a.md')
    expect(spaceOf('/')).toBe('/')
  })
})

describe('containment', () => {
  test('holds for anything below', () => {
    expect(within('/Notes', '/Notes/a.md')).toBe(true)
    expect(within('/Notes', '/Notes/deep/a.md')).toBe(true)
  })

  test('does not hold for a sibling with a shared prefix', () => {
    expect(within('/Notes', '/Notes2/a.md')).toBe(false)
  })

  test('does not hold for the folder itself', () => {
    expect(within('/Notes', '/Notes')).toBe(false)
  })

  test('the root holds everything', () => {
    expect(within('/', '/anything.md')).toBe(true)
  })
})

describe('recognising markdown', () => {
  test('takes every extension the app opens', () => {
    for (const name of ['a.md', 'a.markdown', 'a.mdown', 'a.mkd', 'A.MD']) {
      expect(isMarkdown(name), name).toBe(true)
    }
  })

  test('refuses anything else', () => {
    expect(isMarkdown('a.txt')).toBe(false)
    expect(isMarkdown('a.md.bak')).toBe(false)
  })
})

describe('making a name safe', () => {
  test('keeps an ordinary one', () => {
    expect(safeName('Work notes')).toBe('Work notes')
  })

  test('drops what a filesystem would refuse', () => {
    expect(safeName('a/b\\c:d')).toBe('a b c d')
    expect(safeName('a<b>c|d*e"f')).toBe('a b c d e f')
  })

  test('trims dots and spaces from the ends', () => {
    expect(safeName('  Notes.  ')).toBe('Notes')
  })

  test('gives nothing back when nothing is left', () => {
    expect(safeName('   ')).toBeNull()
    expect(safeName('///')).toBeNull()
    expect(safeName('...')).toBeNull()
  })

  test('caps the length', () => {
    expect(safeName('x'.repeat(200))?.length).toBe(64)
  })

  test('keeps letters other languages use', () => {
    expect(safeName('Notizen über Bücher')).toBe('Notizen über Bücher')
  })
})
