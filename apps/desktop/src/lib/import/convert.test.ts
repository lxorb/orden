import { describe, expect, test } from 'vitest'

import { convertIdLinks, convertTags, converted, idsIn } from './convert'

describe("Bear's closed tags", () => {
  test('become tags, and are counted', () => {
    const said = convertTags('#two words# and #work# again')

    expect(said.text).toBe('#two-words and #work again')
    expect(said.changes).toBe(2)
  })

  test('are left alone inside a fence and in the middle of a word', () => {
    const said = convertTags('a#b#c\n```\n#include <x>\n#define Y#\n```\n')

    expect(said.changes).toBe(0)
    expect(said.text).toContain('#define Y#')
  })

  test('a tag that is already one is not a change', () => {
    expect(convertTags('#work and #home/kitchen').changes).toBe(0)
  })
})

describe('a Zettelkasten id link', () => {
  const ids = idsIn(['202201011200 The first note.md', '202301011200.md', 'Ordinary note.md'])

  test('is written out as the note it means', () => {
    const said = convertIdLinks('See [[202201011200]] for that.', ids)

    expect(said.text).toBe('See [[202201011200 The first note]] for that.')
    expect(said.changes).toBe(1)
  })

  test('keeps the words the link showed', () => {
    expect(convertIdLinks('[[202201011200|the first one]]', ids).text).toBe(
      '[[202201011200 The first note|the first one]]',
    )
  })

  test('a note whose whole name is the id needs no rewriting', () => {
    expect(convertIdLinks('[[202301011200]]', ids).changes).toBe(0)
  })

  test('an id no note carries is left exactly as it was', () => {
    expect(convertIdLinks('[[209901011200]]', ids).text).toBe('[[209901011200]]')
  })

  test('an ordinary wikilink is not an id link', () => {
    expect(convertIdLinks('[[Ordinary note]]', ids).changes).toBe(0)
  })
})

describe('which note each id names', () => {
  test('is the note whose name begins with it', () => {
    const ids = idsIn(['202201011200 A.md', '20220101120000 B.md', 'C.md'])

    expect(ids.get('202201011200')).toBe('202201011200 A')
    expect(ids.get('20220101120000')).toBe('20220101120000 B')
    expect(ids.size).toBe(2)
  })

  test('the first one wins where two notes carry the same id', () => {
    const ids = idsIn(['202201011200 First.md', '202201011200 Second.md'])

    expect(ids.get('202201011200')).toBe('202201011200 First')
  })

  test('a name that only starts with digits is not an id', () => {
    expect(idsIn(['2026 plans.md', '12345 notes.md']).size).toBe(0)
  })
})

describe('both rewrites together', () => {
  test('count as one number', () => {
    const said = converted('#two words# and [[202201011200]]', ['202201011200 A note.md'])

    expect(said.changes).toBe(2)
    expect(said.text).toBe('#two-words and [[202201011200 A note]]')
  })

  test("leave a note that needs nothing exactly as it was, which is what says it doesn't", () => {
    const text = '# A note\n\n#work and [[Another]] and `#code#`\n'

    expect(converted(text, ['Another.md'])).toEqual({ text, changes: 0 })
  })

  test("Roam's own wikilinks are already nib's, so nothing is done to them", () => {
    const text = 'See [[The plan]] and [[Ideas]].'

    expect(converted(text, ['The plan.md', 'Ideas.md']).changes).toBe(0)
  })
})
