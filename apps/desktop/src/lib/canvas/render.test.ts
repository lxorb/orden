import { describe, expect, test, vi } from 'vitest'

vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({
      notes: [{ path: 'Plan.md', name: 'Plan', headings: [], blocks: [] }],
      path,
      read: () => Promise.resolve(null),
    }),
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target.toLowerCase() === 'plan' ? 'Plan.md' : null,
    fileFor: (name: string) => (name === 'kept.png' ? '/space/pictures/kept.png' : null),
  },
}))

const { cardHtml, fileShown, fileSource, fileUrl, keptByAccount } = await import('./render')

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

  test('shows the HTML as characters, for a plane from anywhere else', () => {
    const html = cardHtml(HOSTILE, null, false)

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<u>more</u>')
    expect(html).toContain('&lt;img src=x')
  })

  test('remembers the two answers apart', () => {
    expect(cardHtml(HOSTILE, null, true)).toContain('<img src=x')
    expect(cardHtml(HOSTILE, null, false)).not.toContain('<img src=x')
    expect(cardHtml(HOSTILE, null, true)).toContain('<img src=x')
  })
})

describe('a picture in a card', () => {
  const sources = (html: string) =>
    [...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((one) => one[1])

  test('is found beside the plane, as a note finds its pictures', () => {
    const [src] = sources(cardHtml('![a](pictures/a.png)\n', '/space/Board.canvas', true))
    expect(src).not.toBe('pictures/a.png')
    expect(src).toContain('/space/pictures/a.png')
  })

  test('named alone is found wherever the space keeps it', () => {
    const [src] = sources(cardHtml('![[kept.png]]\n', '/space/Board.canvas', false))
    expect(src).toContain('/space/pictures/kept.png')
  })

  test('on the network is left where it is', () => {
    const html = cardHtml('![a](https://x.test/a.png)\n', '/space/Board.canvas', true)
    expect(sources(html)).toEqual(['https://x.test/a.png'])
  })
})

describe('a picture on the plane', () => {
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

describe('a file card', () => {
  test('is shown by what the file holds', () => {
    expect(fileShown('pictures/Sun.PNG')).toBe('picture')
    expect(fileShown('clips/Talk.mp4')).toBe('film')
    expect(fileShown('https://example.com/clip.webm?t=3')).toBe('film')
    expect(fileShown('sounds/Song.mp3')).toBe('sound')
    expect(fileShown('papers/Thesis.pdf')).toBe('pdf')
    expect(fileShown('Plan.md')).toBe('words')
    expect(fileShown('Board.canvas')).toBe('words')
  })

  test('of a film, a sound or a PDF is never read as words', async () => {
    for (const file of ['clips/Talk.mp4', 'sounds/Song.mp3', 'papers/Thesis.pdf', 'Sun.png']) {
      expect(await fileSource(file, '/space/Board.canvas')).toBeNull()
    }
  })
})
