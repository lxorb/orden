// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

/** The space around the plane and the save, stood in for. What a picture of a
 *  plane has to get right is the question the plane on screen already asks of
 *  every card: whose words these are. An SVG opened on its own is a document,
 *  and a PDF of one is printed from a window of the app's own, so a
 *  collaborator's `<img onerror>` in a card is their markup in both. */
const world = vi.hoisted(() => ({ saved: [] as string[], printed: [] as string[] }))

vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
  },
}))
vi.mock('../export/save', () => ({
  chooseTarget: () => Promise.resolve(null),
  download: (_name: string, payload: { text: string }) => world.saved.push(payload.text),
}))

vi.mock('../export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export')>()),
  printInFrame: (html: string) => {
    world.printed.push(html)
    return Promise.resolve()
  },
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    command === 'read_asset'
      ? Promise.resolve(`data:image/png;base64,${args?.path ?? ''}`)
      : Promise.resolve(null),
}))

const { readCanvas } = await import('./format')
const { canvasSvg, exportCanvasSvg, inlinedSvg, printCanvas } = await import('./picture')

const HOSTILE = '<img src=x onerror="alert(1)">'

const plane = () =>
  readCanvas(
    JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: `Card ${HOSTILE}`, x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
      // A shape is the app's own, and is kept beside the nodes; see readCanvas.
      nib: {
        shapes: [
          {
            id: 'b',
            shape: 'rect',
            text: `Shape ${HOSTILE}`,
            x: 300,
            y: 0,
            width: 200,
            height: 100,
          },
        ],
      },
    }),
  )

describe('a picture of somebody else’s plane', () => {
  test('shows the HTML in its cards and shapes as the characters it is made of', () => {
    const svg = canvasSvg(plane(), {}, null, null, false, false)

    expect(svg).not.toContain('<img src=x')
    expect(svg).not.toContain('<img src="x"')
    expect(svg.match(/&lt;img src=x onerror=/g)).toHaveLength(2)
  })

  test('and the reader’s own plane keeps its markup', () => {
    const svg = canvasSvg(plane(), {}, null, null, false, true)
    expect(svg).toMatch(/<img src="?x"?/)
  })

  test('the file saved is the one the trust answer was asked of', async () => {
    world.saved = []
    await exportCanvasSvg({
      canvas: plane(),
      palette: {},
      path: null,
      root: null,
      name: 'Board.canvas',
      trusted: false,
    })

    expect(world.saved).toHaveLength(1)
    expect(world.saved[0]).not.toMatch(/<im(g|age) [^>]*onerror/)
  })
})

describe('a picture with its pictures inlined', () => {
  const inFoo = (body: string) => `<foreignObject><div>${body}</div></foreignObject>`

  test('keeps a card’s picture an `img`, inlined, which is the tag XHTML shows', async () => {
    const svg = await inlinedSvg(`<svg>${inFoo('<img src="p.png" alt="p" />')}</svg>`)
    expect(svg).toContain('<img src="data:image/png;base64,p.png" alt="p" />')
    expect(svg).not.toContain('<image')
  })

  test('leaves the words `src="q"` in a card’s code as they are', async () => {
    const words = '<code>src="q" and href="r"</code>'
    expect(await inlinedSvg(`<svg>${inFoo(words)}</svg>`)).toContain(words)
  })

  test('inlines a picture on the plane where it sits, as an `image` with an `href`', async () => {
    const svg = await inlinedSvg(`<svg><image x="1" href="a.png"/></svg>`)
    expect(svg).toBe(`<svg><image x="1" href="data:image/png;base64,a.png"/></svg>`)
  })

  test('both in one drawing, and a link in a card keeps its `href`', async () => {
    const svg = await inlinedSvg(
      `<svg><image href="a.png"/>${inFoo('<a href="b.md">b</a><img src="c.png"/>')}</svg>`,
    )
    expect(svg).toContain('<image href="data:image/png;base64,a.png"/>')
    expect(svg).toContain('<a href="b.md">b</a>')
    expect(svg).toContain('<img src="data:image/png;base64,c.png"/>')
  })

  test('leaves alone a picture that is already an address on the network', async () => {
    const svg = `<svg><image href="https://x.test/a.png"/></svg>`
    expect(await inlinedSvg(svg)).toBe(svg)
  })
})

/** Printing a plane of one's own prints its markup, and on a Mac and for a PDF that page
 *  is a file in a window of its own, which the app's content policy does not reach. So
 *  the sheet carries a policy of its own, the one a note's page does (#612). */
describe('the sheet a plane of one’s own is printed on', () => {
  const printed = async (text: string) => {
    world.printed = []
    await printCanvas({
      canvas: readCanvas(
        JSON.stringify({
          nodes: [{ id: 'a', type: 'text', text, x: 0, y: 0, width: 200, height: 100 }],
          edges: [],
        }),
      ),
      palette: {},
      path: null,
      root: null,
      name: 'Board.canvas',
      trusted: true,
    })
    return world.printed[0] ?? ''
  }

  test('forbids every script before anything on it is read', async () => {
    const page = await printed('Card')
    const head = page.slice(0, page.indexOf('<body>'))
    expect(head).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'none'/,
    )
    expect(page.indexOf('Content-Security-Policy')).toBeLessThan(page.indexOf('<title>'))
  })

  test('lets a picture too big to inline still load from the app’s own address', async () => {
    const page = await printed('Card')
    expect(page).toMatch(/img-src [^;"]*asset: http:\/\/asset\.localhost/)
  })

  test('holds a page in a frame as the card it is on screen, and no frame', async () => {
    const page = await printed('<iframe src="https://x.test/page"></iframe>')
    const dom = new DOMParser().parseFromString(page, 'text/html')
    expect(dom.querySelector('iframe')).toBeNull()
    expect(dom.querySelector('[data-frame]')?.getAttribute('data-frame')).toBe(
      'https://x.test/page',
    )
    expect(page).not.toContain('frame-src')
  })

  test('keeps markup of one’s own, handlers under that policy', async () => {
    const page = await printed('<u>mine</u> <img src="x.png" onerror="alert(1)">')
    expect(page).toContain('<u')
  })

  test.each([
    ['a target', '<a href="javascript:alert(1)">go</a>'],
    ['a spelled-out target', '<a href="jav&#x61;script:alert(1)">go</a>'],
    ['a markdown link', '[go](javascript:alert(1))'],
    ['a script', '<script>alert(1)</script>'],
    ['a frame', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['a refresh', '<meta http-equiv="refresh" content="0;url=https://x.test">'],
  ])('holds no live %s', async (_what, text) => {
    const page = await printed(text)
    const dom = new DOMParser().parseFromString(page, 'text/html')
    expect(dom.querySelector('body script, body iframe[srcdoc], body meta')).toBeNull()
    for (const link of dom.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/script:/i)
    }
  })
})
