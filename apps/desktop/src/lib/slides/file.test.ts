import { describe, expect, test, vi } from 'vitest'
import { deckBody, FIT_STEPS } from '@nib/markdown/deck'
import { buildDeckHtml, DECK_PAPER, exportDeck } from './file'
import type { StageSlide } from './render'

/** The renderer and the save are stood in for: what is under test is the trust
 *  answer reaching the renderer, and the file that comes back. */
const world = vi.hoisted(() => ({
  trusted: [] as boolean[],
  saved: [] as string[],
}))

vi.mock('./render', () => ({
  deckHtml: (_note: unknown, _scheme: unknown, trusted: boolean) => {
    world.trusted.push(trusted)
    return Promise.resolve([])
  },
}))
vi.mock('../export/save', () => ({
  chooseTarget: () => Promise.resolve(null),
  download: (_name: string, payload: { text: string }) => world.saved.push(payload.text),
}))

function slide(html: string, over: Partial<StageSlide> = {}): StageSlide {
  return { html, notes: '', vertical: false, fragments: [], shape: 'prose', from: 0, ...over }
}

const DECK = [
  slide('<h1>Nib</h1>', { shape: 'title' }),
  slide('<p>Words.</p>'),
  slide('<ul><li>a</li><li>b</li></ul>', { fragments: [0, 1] }),
  slide('<h2>Detail</h2>', { vertical: true }),
]

/** How many pages the file holds. */
const stages = (html: string) => html.match(/<div class="stage">/g)?.length ?? 0

describe('a deck written out as one page per slide', () => {
  const html = buildDeckHtml(DECK, 'Talk')

  test('every slide is a page of its own', () => {
    expect(stages(html)).toBe(DECK.length)
  })

  test('an empty deck is a page with no slides on it', () => {
    expect(stages(buildDeckHtml([], 'Talk'))).toBe(0)
  })

  test('each page says what shape it is', () => {
    expect(html).toContain('data-shape="title"')
    expect(html).toContain('data-shape="prose"')
  })

  test('a slide that goes downwards says so, and the others do not', () => {
    expect(html.match(/data-vertical="yes"/g)).toHaveLength(1)
  })

  test('the items that wait for a click are named by their place', () => {
    expect(html).toContain('data-steps="2" data-fragments="0,1"')
  })

  test('the title is the file`s title', () => {
    expect(html).toContain('<title>Talk</title>')
  })

  test('the paper is the size of the stage', () => {
    expect(html).toContain('@page { size: 1280px 720px; margin: 0; }')
    // All four fields, because PdfPage in src-tauri/src/pdf.rs takes all four
    // and a page missing one is a command that refuses to read its argument.
    expect(DECK_PAPER).toEqual({
      width: 1280 / 96,
      height: 720 / 96,
      margin: 0,
      landscape: false,
    })
  })
})

describe('a deck that stands on its own', () => {
  const html = buildDeckHtml(DECK, 'Talk')

  test('nothing is fetched: no stylesheet, no script, no font off the network', () => {
    expect(html).not.toContain('<link')
    expect(html).not.toContain('src="http')
    expect(html).not.toMatch(/url\(['"]?https?:/)
  })

  test('the theme travels with it', () => {
    expect(html).toContain('--accent')
    expect(html).toContain('.deck')
  })

  test('it turns its own pages', () => {
    expect(html).toContain('<script nonce=')
    expect(html).toContain("addEventListener('keydown'")
  })

  test('a deck on its way to a printer turns no pages, but still lays itself out', () => {
    // Every slide is on the page and the print rules give each a sheet, so every
    // one of them has to be fitted: none was ever on screen to be measured, and
    // one that had to shrink would otherwise be cut off.
    const paper = buildDeckHtml(DECK, 'Talk', { interactive: false })

    expect(stages(paper)).toBe(DECK.length)
    expect(paper).toContain('function fitAll()')
    expect(paper).not.toContain("addEventListener('keydown'")
  })

  test('both builds shrink a slide by the same rungs', () => {
    const ladder = JSON.stringify([...FIT_STEPS])
    expect(buildDeckHtml(DECK, 'Talk')).toContain(ladder)
    expect(buildDeckHtml(DECK, 'Talk', { interactive: false })).toContain(ladder)
  })

  test('the scheme it was built for is the one the page wears', () => {
    expect(buildDeckHtml(DECK, 'Talk', { scheme: 'light' })).toContain('data-theme="light"')
    expect(buildDeckHtml(DECK, 'Talk', { scheme: 'dark' })).toContain('data-theme="dark"')
  })

  test('a theme file and custom css are baked in', () => {
    expect(buildDeckHtml(DECK, 'Talk', { css: '.deck { --mine: 1px }' })).toContain('--mine: 1px')
  })
})

describe('the markup a deck page is made of', () => {
  test('the slides come out in the order they were written', () => {
    const body = deckBody([slide('<p>one</p>'), slide('<p>two</p>')])
    expect(body.indexOf('one')).toBeLessThan(body.indexOf('two'))
  })

  test('a slide with nothing waiting names no items', () => {
    expect(deckBody([slide('<p>one</p>')])).not.toContain('data-fragments')
  })

  test('the progress line and the counter are the only furniture', () => {
    const body = deckBody([slide('<p>one</p>')])
    expect(body).toContain('<div class="rail">')
    expect(body).toContain('<div class="count">')
  })
})

/** A deck is the same question the reading view asks: whose words these are. A
 *  collaborator's `<img onerror>` in a shared space is their markup, and a file
 *  of it is opened in a browser, and a PDF of it drawn in a window of the app's
 *  own. */
describe('a deck of somebody else’s note', () => {
  test('is rendered with their HTML as characters', async () => {
    world.trusted = []
    await exportDeck({ text: '# Plan', path: 'Shared/plan.md', trusted: false }, 'Plan.md')
    expect(world.trusted).toEqual([false])
  })

  test('and the reader’s own keeps its markup', async () => {
    world.trusted = []
    await exportDeck({ text: '# Plan', path: 'Notes/plan.md', trusted: true }, 'Plan.md')
    expect(world.trusted).toEqual([true])
  })
})

/** The content policy a deck carries: its own script runs, and nothing else. A
 *  trusted note's raw HTML is the reader's own, but a script in it is no part of
 *  the deck, and the page is opened later in whatever browser the reader has. */
describe('the content policy a deck carries', () => {
  const policyOf = (html: string) =>
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? ''

  test('lets only the deck’s own script run, in both builds', () => {
    for (const html of [
      buildDeckHtml([slide('<p>x</p>')], 'Talk'),
      buildDeckHtml([slide('<p>x</p>')], 'Talk', { interactive: false }),
    ]) {
      const policy = policyOf(html)
      expect(policy).toContain("default-src 'none'")
      expect(policy).toContain("object-src 'none'")
      expect(policy).toContain("base-uri 'none'")
      expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/)

      const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1]
      expect(nonce).toBeTruthy()
      expect(html).toContain(`<script nonce="${nonce}">`)
    }
  })

  test('a script a slide carries is not the deck’s', () => {
    const html = buildDeckHtml([slide('<script>alert(1)</script>')], 'Talk')
    expect(html).toContain('<script>alert(1)</script>')
    expect(html.match(/<script nonce=/g)).toHaveLength(1)
  })

  test('still lets the page draw what it carries', () => {
    const policy = policyOf(buildDeckHtml(DECK, 'Talk'))
    expect(policy).toMatch(/img-src [^;]*data:/)
    expect(policy).toMatch(/font-src [^;]*data:/)
    expect(policy).toMatch(/style-src [^;]*'unsafe-inline'/)
  })

  test('comes before anything in the head it governs', () => {
    const html = buildDeckHtml(DECK, 'Talk')
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'))
  })

  test('the saved file is the page that carries it', async () => {
    world.saved = []
    await exportDeck({ text: '# Plan', path: null, trusted: true }, 'Plan.md')
    expect(world.saved.at(0)).toContain('Content-Security-Policy')
  })
})
