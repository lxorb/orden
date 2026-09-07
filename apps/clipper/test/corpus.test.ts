/** The pipeline, end to end, over saved pages.
 *
 *  Each fixture is a page as a browser would hand it over: chrome around the
 *  article, scripts in it, addresses relative to where it was served from. It
 *  goes through the same `readPage` the content script calls, and what comes
 *  out is checked as markdown - because that is what lands in the note, and a
 *  test against the intermediate HTML would pass while the note was wrong. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { fill } from '../src/lib/placeholders'
import { noteFor } from '../src/lib/note'
import { readPage } from '../src/lib/reading'
import type { Kind } from '../src/lib/kinds'

const SITE = 'https://ledgerly.example/blog/mmap-import/'

function pageFrom(name: string, url = SITE): Document {
  const html = readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
  return new JSDOM(html, { url }).window.document
}

/** A clip with its pictures still where the page keeps them, which is what the
 *  popup previews. */
function clipOf(name: string, kind: Kind = 'page', url = SITE) {
  const clip = readPage(pageFrom(name, url), kind, url)
  return { ...clip, markdown: fill(clip.markdown, clip.images) }
}

describe('a technical post', () => {
  const clip = clipOf('code.html')

  test('takes its title from the article rather than the tab', () => {
    expect(clip.origin.title).toBe('Reading a file without reading a file')
  })

  test('leaves the site chrome behind', () => {
    expect(clip.markdown).not.toContain('Careers')
    expect(clip.markdown).not.toContain('Legal')
  })

  test('writes headings as hashes', () => {
    expect(clip.markdown).toContain('## What the profile said')
  })

  test('writes the emphasis the editor writes', () => {
    expect(clip.markdown).toContain('**most of its wall clock**')
    expect(clip.markdown).toContain('*parser*')
  })

  test('fences code with the language the page named', () => {
    expect(clip.markdown).toContain('```rust\nlet file = File::open(path)?;')
  })

  test('fences a preformatted block that names no language', () => {
    expect(clip.markdown).toContain('```\n$ cargo bench --bench import')
  })

  test('keeps code out of the escaping the rest of the text gets', () => {
    expect(clip.markdown).toContain('*byte == b')
  })

  test('nests a list inside a list', () => {
    expect(clip.markdown).toContain('1. Every ledger file was read whole into memory.')
    expect(clip.markdown).toContain('\n   - Even the ones we skipped after the first line.')
    expect(clip.markdown).toContain('\n3. Then the parser copied it again, into its own arena.')
  })

  test('marks a quotation', () => {
    expect(clip.markdown).toContain('> Nine hundred milliseconds became forty.')
  })

  test('resolves a link relative to the page it was on', () => {
    expect(clip.markdown).toContain('(https://ledgerly.example/blog/mmap-import/patch.diff)')
  })

  test('resolves a link that climbs out of the page folder', () => {
    expect(clip.markdown).toContain('(https://ledgerly.example/blog/bench/README.md)')
  })

  test('reads the tags the page publishes about itself', () => {
    expect(clip.origin.tags).toEqual(['rust', 'io', 'performance'])
  })
})

describe('a documentation page', () => {
  const clip = clipOf('table.html', 'page', 'https://docs.example/ops/retention')

  test('writes a table as a pipe table', () => {
    expect(clip.markdown).toContain('| Window | Recovers from | Cost per TB |')
    expect(clip.markdown).toContain('| 14 days |')
  })

  test('keeps the emphasis inside a cell', () => {
    expect(clip.markdown).toContain('a deleted *space*')
  })

  test('keeps a checklist as a list, though the extractor takes its ticks', () => {
    // Readability throws away form controls, the tick among them. A selection
    // does not go through it and keeps the whole task list; see markdown.test.ts.
    expect(clip.markdown).toContain('- Measure what a day of writes actually is')
  })

  test('writes a strikethrough', () => {
    expect(clip.markdown).toContain('~~keep everything forever~~')
  })

  test('leaves an absolute link alone', () => {
    expect(clip.markdown).toContain('(https://example.org/standards/retention)')
  })

  test('drops what the page marks as decoration', () => {
    expect(clip.markdown).not.toContain('#windows')
  })

  test('collects a tag from each meta that carries one', () => {
    expect(clip.origin.tags).toEqual(['Operations', 'Storage'])
  })
})

describe('an article of photographs', () => {
  const clip = clipOf('images.html', 'page', 'https://journal.example/kilns/rosswein')

  test('resolves a picture against the page', () => {
    expect(clip.markdown).toContain(
      '![The north kiln, half collapsed](https://journal.example/kilns/photos/kiln-north.jpg)',
    )
  })

  test('keeps the caption under the picture', () => {
    expect(clip.markdown).toContain('The north kiln, photographed in 2019.')
  })

  test('takes the widest candidate a picture element offers', () => {
    expect(clip.markdown).toContain('https://journal.example/kilns/photos/cart-1600.jpg')
  })

  test('finds the address a lazy picture was deferring', () => {
    expect(clip.markdown).toContain('https://journal.example/photos/slope-2004.jpg')
  })

  test('never leaves a placeholder pixel in the note', () => {
    expect(clip.markdown).not.toContain('data:image/gif')
  })

  test('numbers every picture it found, once each', () => {
    expect(new Set(clip.images).size).toBe(clip.images.length)
    expect(clip.images.every((url) => url.startsWith('https://'))).toBe(true)
  })

  test('leaves a drawn icon out', () => {
    expect(clip.markdown).not.toContain('<svg')
    expect(clip.markdown).not.toContain('viewBox')
  })

  test('resolves a link to a folder', () => {
    expect(clip.markdown).toContain('(https://journal.example/kilns/gallery/)')
  })
})

describe('a page with no article in it', () => {
  const clip = clipOf('listing.html', 'page', 'https://tracker.example/issues')

  test('falls back to the body rather than clipping nothing', () => {
    expect(clip.markdown).toContain('Importer holds the lock too long')
  })

  test('takes the title from the tab, since there is no headline to take', () => {
    expect(clip.origin.title).toBe('Open issues')
  })

  test('leaves the form behind', () => {
    expect(clip.markdown).not.toContain('Open an issue')
  })
})

describe('an article among advertisements', () => {
  const clip = clipOf('noisy.html', 'page', 'https://paper.example/0814')

  test('keeps the article', () => {
    expect(clip.markdown).toContain('The 08:14 from Winterthur')
  })

  test('never lets a script into the note', () => {
    expect(clip.markdown).not.toContain('dataLayer')
    expect(clip.markdown).not.toContain('console.log')
  })

  test('never lets a stylesheet into the note', () => {
    expect(clip.markdown).not.toContain('display: flex')
  })

  test('leaves the buttons and the embed behind', () => {
    expect(clip.markdown).not.toContain('Share')
    expect(clip.markdown).not.toContain('player.example.com')
  })

  test('leaves what the page says is not for reading', () => {
    expect(clip.markdown).not.toContain('buy a second train')
    expect(clip.markdown).not.toContain('Enable JavaScript')
  })
})

describe('the note a clip becomes', () => {
  const clip = clipOf('noisy.html', 'page', 'https://paper.example/0814')
  const note = noteFor(clip.origin, clip.markdown, new Date('2026-03-04T09:12:00Z'))

  test('opens with front matter', () => {
    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('source: https://paper.example/0814')
    expect(note).toContain('clipped: 2026-03-04T09:12:00.000Z')
  })

  test('quotes a title that would otherwise open a mapping', () => {
    expect(note).toContain("title: 'Why the 08:14 is always late: a timetable read closely'")
  })

  test('states the title once, as a heading', () => {
    const headings = [...note.matchAll(/^# .+$/gm)]
    expect(headings).toHaveLength(1)
  })

  test('has the front matter, the heading and the article in that order', () => {
    const heading = note.indexOf('\n# ')
    expect(note.indexOf('---')).toBeLessThan(heading)
    expect(heading).toBeLessThan(note.indexOf('The 08:14 from Winterthur'))
  })
})

describe('clipping a selection', () => {
  test('is called what the page calls itself, not what its tab says', () => {
    // `document.title` on this page carries the site's name after a pipe;
    // `og:title` is the headline on its own, which is what a note wants.
    const clip = clipOf('code.html', 'selection')
    expect(clip.origin.title).toBe('Reading a file without reading a file')
  })
})

describe('clipping a link', () => {
  const clip = clipOf('code.html', 'link')

  test('records the page it was on', () => {
    expect(clip.origin.url).toBe(SITE)
  })

  test('says the address and nothing else', () => {
    const note = noteFor(clip.origin, clip.markdown, new Date('2026-03-04T09:12:00Z'))
    expect(note).toContain(`<${SITE}>`)
  })
})

describe('clipping a link from the page menu', () => {
  test('is called what the link says it is', () => {
    const document = pageFrom('code.html')
    const clip = readPage(document, 'link', SITE, 'https://ledgerly.example/authors/mira')

    expect(clip.origin.url).toBe('https://ledgerly.example/authors/mira')
    expect(clip.origin.title).toBe('Mira Halvorsen')
  })

  test('falls back to the address when the link shows no words', () => {
    const document = pageFrom('images.html', 'https://journal.example/kilns/rosswein')
    const clip = readPage(
      document,
      'link',
      'https://journal.example/kilns/rosswein',
      'https://archive.example.net/rosswein.pdf',
    )

    expect(clip.origin.title).toBe('a PDF')
  })
})
