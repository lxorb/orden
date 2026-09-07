import { describe, expect, test } from 'vitest'
import type { Origin } from './extract'
import { byteLength, fileName, fits, frontMatter, MAX_NOTE_BYTES, noteFor } from './note'

const AT = new Date('2026-03-04T09:12:00Z')

function origin(over: Partial<Origin> = {}): Origin {
  return {
    kind: 'page',
    url: 'https://site.example/a',
    title: 'A title',
    tags: [],
    ...over,
  }
}

describe('front matter', () => {
  test('says where, what, when and about what', () => {
    expect(frontMatter(origin({ tags: ['one', 'two'] }), AT)).toBe(
      [
        '---',
        'source: https://site.example/a',
        'title: A title',
        'clipped: 2026-03-04T09:12:00.000Z',
        'tags: [one, two]',
        '---',
      ].join('\n'),
    )
  })

  test('states an empty tag list rather than leaving the field out', () => {
    expect(frontMatter(origin(), AT)).toContain('tags: []')
  })

  test('quotes a title whose colon would open a mapping', () => {
    expect(frontMatter(origin({ title: 'Rust 1.0: a retrospective' }), AT)).toContain(
      "title: 'Rust 1.0: a retrospective'",
    )
  })

  test('quotes a title whose hash would open a comment', () => {
    expect(frontMatter(origin({ title: 'Sprint 4 #done' }), AT)).toContain(
      "title: 'Sprint 4 #done'",
    )
  })

  test('quotes a title that starts with something YAML reads as syntax', () => {
    expect(frontMatter(origin({ title: '- not a list' }), AT)).toContain("title: '- not a list'")
    expect(frontMatter(origin({ title: '"quoted"' }), AT)).toContain(`title: '"quoted"'`)
  })

  test('doubles a quote inside a quoted value, as YAML asks', () => {
    expect(frontMatter(origin({ title: "It's: here" }), AT)).toContain("title: 'It''s: here'")
  })

  test('leaves an ordinary address unquoted, colons and all', () => {
    expect(frontMatter(origin({ url: 'https://site.example/a?b=1#c' }), AT)).toContain(
      'source: https://site.example/a?b=1#c',
    )
  })

  test('quotes a tag that would break the list', () => {
    expect(frontMatter(origin({ tags: ['a, b'] }), AT)).toContain("tags: ['a, b']")
  })
})

describe('the file a clip wants to be', () => {
  test('is the title with an extension', () => {
    expect(fileName('A title')).toBe('A title.md')
  })

  test('replaces what a filesystem refuses', () => {
    expect(fileName('Rust 1.0: a/b "c" <d>')).toBe('Rust 1.0 a b c d.md')
  })

  test('keeps a hyphen, which a filesystem does not mind', () => {
    expect(fileName('Well-being at work')).toBe('Well-being at work.md')
  })

  test('is one line', () => {
    expect(fileName('Two\nlines')).toBe('Two lines.md')
  })

  test('never ends in a dot or a space', () => {
    expect(fileName('  Trailing.  ')).toBe('Trailing.md')
  })

  test('stops at sixty characters', () => {
    const long = 'a'.repeat(200)
    expect(fileName(long)).toBe(`${'a'.repeat(60)}.md`)
  })

  test('falls back to a name rather than an extension on its own', () => {
    expect(fileName('')).toBe('Untitled.md')
    expect(fileName('///')).toBe('Untitled.md')
  })
})

describe('the note itself', () => {
  test('is front matter, then the title, then the article', () => {
    expect(noteFor(origin(), 'The body.', AT)).toBe(
      [
        '---',
        'source: https://site.example/a',
        'title: A title',
        'clipped: 2026-03-04T09:12:00.000Z',
        'tags: []',
        '---',
        '',
        '# A title',
        '',
        'The body.',
        '',
      ].join('\n'),
    )
  })

  test('states the title once when the article opened with it too', () => {
    const note = noteFor(origin(), '# A title\n\nThe body.', AT)

    expect([...note.matchAll(/^# /gm)]).toHaveLength(1)
    expect(note).toContain('# A title\n\nThe body.')
  })

  test('sees through the escaping the converter added to that heading', () => {
    const note = noteFor(origin({ title: '1. Beginnings' }), '# 1\\. Beginnings\n\nThe body.', AT)
    expect([...note.matchAll(/^# /gm)]).toHaveLength(1)
  })

  test('keeps a heading that is not the title', () => {
    const note = noteFor(origin(), '# Something else\n\nThe body.', AT)
    expect([...note.matchAll(/^# /gm)]).toHaveLength(2)
  })

  test('says the address and nothing else for a clipped link', () => {
    const note = noteFor(origin({ kind: 'link' }), '', AT)
    expect(note).toContain('# A title\n\n<https://site.example/a>\n')
  })

  test('calls a note with no title at all Untitled', () => {
    expect(noteFor(origin({ title: '   ' }), 'body', AT)).toContain('# Untitled')
  })
})

describe('how large a note may be', () => {
  test('counts what the service counts, which is bytes and not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('ä')).toBe(2)
    expect(byteLength('絵')).toBe(3)
  })

  test('takes a note up to the limit', () => {
    expect(fits('a'.repeat(MAX_NOTE_BYTES))).toBe(true)
  })

  test('refuses one past it', () => {
    expect(fits('a'.repeat(MAX_NOTE_BYTES + 1))).toBe(false)
  })

  test('measures multibyte text as the service will', () => {
    expect(fits('絵'.repeat(MAX_NOTE_BYTES / 2))).toBe(false)
  })
})
