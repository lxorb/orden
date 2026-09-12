import { describe, expect, test } from 'vitest'
import { frontMatterValue } from '@nib/markdown/front-matter'
import { clipNote, webNote, webTitleOf, webUrlOf } from './note'
import { refusedAt } from './frame'

const WHEN = new Date('2026-09-12T08:30:00.000Z')

describe('the file a website is', () => {
  const written = webNote('https://svelte.dev/docs', 'Svelte docs', WHEN)

  test('says where it points, what it is called and when', () => {
    expect(frontMatterValue(written, 'url')).toBe('https://svelte.dev/docs')
    expect(frontMatterValue(written, 'title')).toBe('Svelte docs')
    expect(frontMatterValue(written, 'date')).toBe('2026-09-12T08:30:00.000Z')
  })

  /** The heading is what names the file: `workspace.noteFrom` reads it off the top
   *  the way it does for every other note this app writes. */
  test('states the title as its heading, so the file is named after it', () => {
    expect(written).toContain('\n# Svelte docs\n')
  })

  /** Read next door in Obsidian, which knows nothing about web tabs, the file is a
   *  note with a link in it. */
  test('says the address again as a link somebody can follow', () => {
    expect(written).toContain('<https://svelte.dev/docs>')
  })

  test('falls back to the address when the page has no title', () => {
    const bare = webNote('https://example.com/a', '   ', WHEN)
    expect(frontMatterValue(bare, 'title')).toBe('https://example.com/a')
  })

  test('reads back what it wrote', () => {
    expect(webUrlOf(written)).toBe('https://svelte.dev/docs')
    expect(webTitleOf(written)).toBe('Svelte docs')
  })
})

describe('which notes are websites', () => {
  test('a note with no url is prose', () => {
    expect(webUrlOf('# Idea\n\nSome words.\n')).toBeNull()
    expect(webUrlOf('---\ntitle: Idea\n---\n\n# Idea\n')).toBeNull()
    expect(webUrlOf(null)).toBeNull()
  })

  /** A note can arrive from a shared space, a room or somebody's export, so the key
   *  is judged and not only read. */
  test('an address no tab may open is not a website', () => {
    expect(webUrlOf('---\nurl: javascript:alert(1)\n---\n')).toBeNull()
    expect(webUrlOf('---\nurl: file:///etc/passwd\n---\n')).toBeNull()
    expect(webUrlOf('---\nurl: not an address\n---\n')).toBeNull()
  })

  test('a title nobody wrote is no title', () => {
    expect(webTitleOf('---\nurl: https://a.example/\ntitle:\n---\n')).toBeNull()
    expect(webTitleOf('# Idea\n')).toBeNull()
  })
})

describe('the note a clip is', () => {
  test('says where it came from and when, and holds the page as markdown', () => {
    const note = clipNote(
      {
        url: 'https://example.com/post',
        title: 'A post',
        html: '<h2>A heading</h2><p>Some <strong>words</strong>.</p>',
      },
      WHEN,
    )

    expect(frontMatterValue(note, 'source')).toBe('https://example.com/post')
    expect(frontMatterValue(note, 'title')).toBe('A post')
    expect(frontMatterValue(note, 'date')).toBe('2026-09-12T08:30:00.000Z')
    expect(note).toContain('\n# A post\n')
    expect(note).toContain('## A heading')
    expect(note).toContain('Some **words**.')
  })

  /** A browser build cannot read the frame's document, so a clip there is the link,
   *  which is what the glyph said it would be. */
  test('a page with no words to keep says the one thing it knows', () => {
    const note = clipNote({ url: 'https://example.com/post', title: 'A post', html: '' }, WHEN)
    expect(note).toContain('<https://example.com/post>')
  })

  test('a page with no title at all is still a note', () => {
    const note = clipNote({ url: 'https://example.com/post', title: '', html: '' }, WHEN)
    expect(frontMatterValue(note, 'title')).toBe('Untitled')
    expect(note).toContain('\n# Untitled\n')
  })

  test('a title that is a paragraph is cut to a line', () => {
    const note = clipNote(
      { url: 'https://example.com/a', title: 'One\nTwo', html: '<p>x</p>' },
      WHEN,
    )
    expect(frontMatterValue(note, 'title')).toBe('One Two')
  })
})

describe('whether a browser framed the page', () => {
  test('a frame still on the blank page was refused', () => {
    expect(refusedAt('about:blank')).toBe(true)
    expect(refusedAt('')).toBe(true)
    expect(refusedAt(undefined)).toBe(true)
  })

  /** Only this origin's addresses read back at all; a page that really loaded throws
   *  instead of answering, which `refused` catches. */
  test('an address that reads back as the page is a page', () => {
    expect(refusedAt('https://svelte.dev/docs')).toBe(false)
  })
})
