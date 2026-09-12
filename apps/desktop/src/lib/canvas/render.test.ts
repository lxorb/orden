import { describe, expect, test, vi } from 'vitest'

/** The space around the plane, stood in for. What a card has to get right is
 *  that it renders as a small page, and that whose page it is decides whether the
 *  HTML in it is markup or is words. */
vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({
      notes: [{ path: 'Plan.md', name: 'Plan', headings: [], blocks: [] }],
      path,
      read: () => Promise.resolve(null),
    }),
    // A card renders through the reading view, which asks the index which note a
    // link means; see `pointer` in reading/render.ts.
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target.toLowerCase() === 'plan' ? 'Plan.md' : null,
  },
}))

const { cardHtml } = await import('./render')

const HOSTILE = '<img src=x onerror="alert(1)"> and <u>more</u>'

describe('a card on the plane', () => {
  test('is a small page, rendered the way the reading view renders one', () => {
    const html = cardHtml('# Heading\n\n- one\n- two\n', '/space/Board.canvas', true)

    expect(html).toContain('<h1')
    expect(html).toContain('<li>')
  })

  test('resolves a link against the plane it sits on', () => {
    const html = cardHtml('See [[Plan]].\n', '/space/Board.canvas', true)
    expect(html).toContain('href="Plan.md"')
  })

  test('runs the HTML in it, for a plane the reader drew', () => {
    expect(cardHtml(HOSTILE, null, true)).toContain('<img src=x onerror="alert(1)">')
  })

  /** A plane arrives through a room card by card, so the words in one may be
   *  anybody's who is in the space; see trust.ts. */
  test('shows the HTML as characters, for a plane from anywhere else', () => {
    const html = cardHtml(HOSTILE, null, false)

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<u>more</u>')
    expect(html).toContain('&lt;img src=x')
  })

  /** The same words are asked about twice, and the two answers differ. A cache
   *  keyed on the words alone would serve the trusting one to both. */
  test('remembers the two answers apart', () => {
    expect(cardHtml(HOSTILE, null, true)).toContain('<img src=x')
    expect(cardHtml(HOSTILE, null, false)).not.toContain('<img src=x')
    expect(cardHtml(HOSTILE, null, true)).toContain('<img src=x')
  })
})
