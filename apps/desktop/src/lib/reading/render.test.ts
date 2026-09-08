import { describe, expect, test, vi } from 'vitest'

/** The space around the note, stood in for: what the reading view has to get
 *  right is that it asks, and what it does with the answers. */
const NOTES = [
  { path: 'Plan.md', name: 'Plan', headings: ['Why it works'], blocks: [] },
  { path: 'ideas/Later.md', name: 'Later', headings: [], blocks: [] },
]

const bodies: Record<string, string> = {
  'Plan.md': '# Plan\n\nThe plan itself.\n\n## Why it works\n\nBecause.\n',
}

const asked: { embeds: string[]; index: (string | null)[] } = { embeds: [], index: [] }

vi.mock('../link-index.svelte', () => ({
  links: {
    index: (path: string | null) => {
      asked.index.push(path)
      return { notes: NOTES, path, read: () => Promise.resolve(null) }
    },
    embedSource: (target: string) => {
      asked.embeds.push(target)
      return Promise.resolve(bodies[`${target}.md`] ?? null)
    },
  },
}))

/** Where a picture ends up is images.ts's business and is tested there; here it
 *  only matters that the reading view runs every `src` through it. */
vi.mock('../note-images', () => ({
  notePicture: (src: string) => `asset://${src}`,
}))

const { readingHtml } = await import('./render')

/** The reading view asks for the exporter the first time it renders a note: the
 *  diagram drawers, the syntax parsers, KaTeX, most of what the app can load.
 *  Loaded here rather than by the first test, where it was three seconds on an
 *  idle machine, past a test's five on a busy one, and every test waiting on the
 *  same import timed out with it. See docs/conventions.md. */
await import('../export')

const note = (text: string) => ({ text, path: '/space/Notes/Today.md' })

describe('the space a note is read in', () => {
  test('is what a wikilink is resolved against', async () => {
    const html = await readingHtml(note('Read [[Plan]] first.\n'), 'light')

    expect(html).toContain('<a class="wikilink" href="Plan.md">Plan</a>')
    expect(asked.index).toContain('/space/Notes/Today.md')
  })

  test('carries the heading a link names, as the anchor on the page', async () => {
    const html = await readingHtml(note('See [[Plan#Why it works]].\n'), 'light')

    expect(html).toContain('href="Plan.md#why-it-works"')
  })

  test('finds a note by the last part of the name it was given', async () => {
    const html = await readingHtml(note('And [[ideas/Later|later]].\n'), 'light')

    expect(html).toContain('<a class="wikilink" href="ideas/Later.md">later</a>')
  })

  test('leaves a link nothing answers to as the words it showed', async () => {
    const html = await readingHtml(note('A [[Nowhere]] link.\n'), 'light')

    expect(html).toContain('A Nowhere link.')
    expect(html).not.toContain('<a class="wikilink"')
  })

  test('points a link into this very note at its own heading', async () => {
    const html = await readingHtml(note('# One\n\nBack to [[#One]].\n'), 'light')

    // Shown as it was written, which is how the editor shows it too.
    expect(html).toContain('<a class="wikilink" href="#one">#One</a>')
  })

  test('is what an embed reads the note it names out of', async () => {
    const html = await readingHtml(note('Before\n\n![[Plan]]\n\nAfter\n'), 'light')

    expect(asked.embeds).toContain('Plan')
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('The plan itself.')
    expect(html).toContain('<figcaption>Plan</figcaption>')
  })

  test('embeds one section when the link names one', async () => {
    const html = await readingHtml(note('![[Plan#Why it works]]\n'), 'light')

    expect(html).toContain('Because.')
    expect(html).not.toContain('The plan itself.')
  })

  test('leaves an embed of a note it has not got as a link', async () => {
    const html = await readingHtml(note('![[Missing]]\n'), 'light')

    expect(html).not.toContain('<figure class="embed">')
  })
})

describe('the page a note is read on', () => {
  test('gives every heading the id the export gives it', async () => {
    const html = await readingHtml(note('# One\n\n## Two words\n'), 'light')

    expect(html).toContain('<h1 id="one">One</h1>')
    expect(html).toContain('<h2 id="two-words">Two words</h2>')
  })

  test('turns a `[toc]` line into the contents', async () => {
    const html = await readingHtml(note('[toc]\n\n# One\n\n## Two\n'), 'light')

    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<a href="#one">One</a>')
  })

  test('gathers the footnotes at the end', async () => {
    const html = await readingHtml(note('Text[^1].\n\n[^1]: The note.\n'), 'light')

    expect(html).toContain('<sup class="footnote-ref" id="fnref-1">')
    expect(html).toContain('<section class="footnotes">')
  })

  test('shows a task box, and it is inert', async () => {
    const html = await readingHtml(note('- [ ] one\n- [x] two\n'), 'light')

    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('class="task-list-item is-done"')
    // Every one of them: a reading view is not a place where a note is changed.
    expect(html.match(/<input/g)).toHaveLength(2)
    expect(html.match(/disabled/g)).toHaveLength(2)
  })

  test('sets its maths', async () => {
    const html = await readingHtml(note('Inline $a^2$ and\n\n$$\nb^2\n$$\n'), 'light')

    expect(html).toContain('<span class="math-inline">')
    expect(html).toContain('<div class="math-block">')
    expect(html).toContain('katex')
  })

  test('leaves no front matter and no block names on the page', async () => {
    const html = await readingHtml(note('---\ntitle: x\n---\n\nA line. ^abc123\n'), 'light')

    expect(html).not.toContain('title: x')
    expect(html).not.toContain('^abc123')
    expect(html).toContain('A line.')
  })

  test('sends every picture through the resolver', async () => {
    const html = await readingHtml(note('![a](pictures/one.png)\n'), 'light')

    expect(html).toContain('src="asset://pictures/one.png"')
  })

  test('leaves a picture from the web where it is', async () => {
    const html = await readingHtml(note('![a](https://example.com/one.png)\n'), 'light')

    // The resolver is still asked; it is the one that knows a remote path.
    expect(html).toContain('asset://https://example.com/one.png')
  })

  test('renders a definition list, an abbreviation and a callout', async () => {
    const html = await readingHtml(
      note('Term\n: Meaning\n\n*[HTML]: HyperText\n\nHTML here.\n\n> [!note]\n> Mind this.\n'),
      'light',
    )

    expect(html).toContain('<dl>')
    expect(html).toContain('<abbr title="HyperText">HTML</abbr>')
    expect(html).toContain('<div class="callout" data-kind="note">')
  })

  test('says how long it took, under a name a profiler can read', async () => {
    performance.clearMeasures('nib:reading')
    await readingHtml(note('# One\n\nWords.\n'), 'light')

    expect(performance.getEntriesByName('nib:reading')).toHaveLength(1)
  })
})
