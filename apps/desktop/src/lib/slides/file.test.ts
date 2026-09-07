import { describe, expect, test } from 'vitest'
import { deckBody } from '@nib/markdown/deck'
import { buildDeckHtml, DECK_PAPER } from './file'
import type { StageSlide } from './render'

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
    expect(DECK_PAPER).toEqual({ width: 1280 / 96, height: 720 / 96 })
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
    expect(html).toContain('<script>')
    expect(html).toContain("addEventListener('keydown'")
  })

  test('a deck on its way to a printer turns no pages', () => {
    // Every slide is simply on the page, and the print rules give each a sheet.
    const paper = buildDeckHtml(DECK, 'Talk', { interactive: false })
    expect(paper).not.toContain('<script>')
    expect(stages(paper)).toBe(DECK.length)
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
