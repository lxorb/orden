import { describe, expect, test } from 'vitest'
import { HIGHLIGHT_COLOURS, highlightTone, readHighlight, writeHighlight } from './highlights'
import { renderMarkdown, setHardBreaks } from './index'

/** The markup is Obsidian's, and this is the whole of the claim: a colour emoji
 *  at the start of the highlight, which 1.14.0 added on 2026-09-02. */
describe('the colour a highlight names', () => {
  test('is the five emoji Obsidian writes, and nothing nib invented', () => {
    expect(HIGHLIGHT_COLOURS.map((one) => one.emoji)).toEqual([null, '🔴', '🟠', '🟢', '🔵', '🟣'])
  })

  test('is read off the front of the words, with the space it was written with', () => {
    expect(readHighlight('🔴 careful')).toEqual({ colour: HIGHLIGHT_COLOURS[1], from: 3 })
    expect(readHighlight('🟣 careful').colour.tone).toBe(6)
  })

  test('is read without the space as well, since a file may hold either', () => {
    expect(readHighlight('🟢careful')).toEqual({ colour: HIGHLIGHT_COLOURS[3], from: 2 })
  })

  test('is nothing for a highlight that never named one', () => {
    expect(readHighlight('careful')).toEqual({ colour: HIGHLIGHT_COLOURS[0], from: 0 })
  })

  test('leaves an emoji that is the whole highlight as the words', () => {
    expect(readHighlight('🔴')).toEqual({ colour: HIGHLIGHT_COLOURS[0], from: 0 })
  })

  test('is written back the way Obsidian writes it', () => {
    expect(writeHighlight('careful', highlightTone(1))).toBe('🔴 careful')
    expect(writeHighlight('careful', highlightTone(null))).toBe('careful')
  })

  test('comes back from a remembered tone, and a tone nothing names is the plain one', () => {
    expect(highlightTone(2).emoji).toBe('🟠')
    expect(highlightTone(3).emoji).toBeNull()
    expect(highlightTone(null).emoji).toBeNull()
  })

  /** There is no yellow, and that is deliberate: Obsidian writes no yellow emoji
   *  because a plain highlight is already its yellow. A tone nib could write and
   *  Obsidian could not read would not be Obsidian-compatible. */
  test('skips the yellow tone, which has no emoji to write it with', () => {
    expect(HIGHLIGHT_COLOURS.map((one) => one.tone)).toEqual([null, 1, 2, 4, 5, 6])
  })
})

describe('a coloured highlight rendered', () => {
  test('wears the tone as a class, and the emoji reaches the page as nothing', () => {
    const html = renderMarkdown('a ==🔴 careful== b')

    expect(html).toContain('<mark class="tone-1">careful</mark>')
    expect(html).not.toContain('🔴')
  })

  test('leaves a highlight with no colour exactly as it always was', () => {
    expect(renderMarkdown('a ==marked== b')).toContain('<mark>marked</mark>')
  })

  test('still renders what is inside it', () => {
    expect(renderMarkdown('==🔵 **bold** here==')).toContain(
      '<mark class="tone-5"><strong>bold</strong> here</mark>',
    )
  })

  test('is escaped like anything else when publishing', () => {
    const html = renderMarkdown('==🟠 <img src=x onerror=alert(1)>==', { escapeHtml: true })

    expect(html).toContain('class="tone-2"')
    expect(html).not.toContain('<img')
  })
})

describe('whether a single newline breaks the line', () => {
  test('is CommonMark until somebody says otherwise', () => {
    expect(renderMarkdown('one\ntwo\n')).not.toContain('<br>')
  })

  test('is the renderer’s own answer, so every caller gets it without asking', () => {
    setHardBreaks(true)
    try {
      expect(renderMarkdown('one\ntwo\n')).toContain('<br>')
    } finally {
      setHardBreaks(false)
    }
  })

  test('is overruled by a caller that says outright, which is what a deck does', () => {
    expect(renderMarkdown('one\ntwo\n', { breaks: true })).toContain('<br>')

    setHardBreaks(true)
    try {
      expect(renderMarkdown('one\ntwo\n', { breaks: false })).not.toContain('<br>')
    } finally {
      setHardBreaks(false)
    }
  })

  test('leaves a blank line a paragraph either way', () => {
    setHardBreaks(true)
    try {
      const html = renderMarkdown('one\n\ntwo\n')
      expect(html).toContain('<p>one</p>')
      expect(html).toContain('<p>two</p>')
    } finally {
      setHardBreaks(false)
    }
  })
})
