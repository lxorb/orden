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

const { cardHtml, fileUrl, keptByAccount } = await import('./render')

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

describe('a picture on the plane', () => {
  // Pasted while signed in, a picture is kept by the account and the card names its
  // address; joined to the space's folder, it was a file nowhere (#364).
  test('kept by the account is loaded from its address as it is', () => {
    const kept = 'https://sync.orden.so/i/ab12cd.png'
    expect(fileUrl(kept, '/space')).toBe(kept)
    expect(fileUrl('HTTP://example.com/a.png', '/space')).toBe('HTTP://example.com/a.png')
  })

  test('kept in the space is loaded from the space', () => {
    expect(fileUrl('pictures/a.png', '/space')).toContain('pictures/a.png')
    expect(fileUrl('pictures/a.png', '/space')).not.toBe('pictures/a.png')
    expect(fileUrl('pictures/a.png', null)).toBe('pictures/a.png')
  })
})

describe('a card the web app wrote before #364', () => {
  const HASH = 'f41264ebbcf7b79f05aa6c7992fd339248711a8f0c775c7394a8c71bb3e1eea3'

  test('names the account’s picture as a path, and is loaded from the account', () => {
    expect(keptByAccount(`i/${HASH}.png`, true)).toBe(`https://orden.so/i/${HASH}.png`)
  })

  test('is left alone signed out, and every other card is', () => {
    expect(keptByAccount(`i/${HASH}.png`, false)).toBeNull()
    expect(keptByAccount('i/cat.png', true)).toBeNull()
    expect(keptByAccount(`pictures/i/${HASH}.png`, true)).toBeNull()
    expect(keptByAccount(`assets/${HASH.slice(0, 16)}.png`, true)).toBeNull()
  })
})
