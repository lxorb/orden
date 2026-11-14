// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  saved: [] as Blob[],
  printed: [] as string[],
  pages: [] as number[],
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
    fileFor: () => null,
  },
}))
vi.mock('../files-out/src/save', () => ({
  chooseTarget: () => Promise.resolve(null),
  download: (_name: string, payload: { pieces: Blob }) => world.saved.push(payload.pieces),
}))

vi.mock('../settings.svelte', () => ({ settings: { exportAppearance: 'light' } }))

const { settings } = await import('../settings.svelte')
vi.mock('../export/src/render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/src/render')>()),
  printInFrame: (html: string) => {
    world.printed.push(html)
    return Promise.resolve()
  },
}))
vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    command === 'read_asset'
      ? Promise.resolve(`data:image/png;base64,${args?.path ?? ''}`)
      : Promise.resolve(null),
}))

vi.mock('../pages/raster', () => ({
  paperPicture: (at: { file: string }, page: number) => {
    world.pages.push(page)
    return Promise.resolve(
      at.file === 'Reading.pdf' ? `data:image/png;base64,UEFHRQ${page}A` : null,
    )
  },
}))

const { readCanvas } = await import('./format')
const { canvasSvg, exportCanvasPdf, exportCanvasSvg, inlinedSvg, printCanvas } =
  await import('./picture')

const HOSTILE = '<img src=x onerror="alert(1)">'

const plane = () =>
  readCanvas(
    JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: `Card ${HOSTILE}`, x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
      orden: {
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
    expect(await world.saved[0]?.text()).not.toMatch(/<im(g|age) [^>]*onerror/)
  })
})

describe('a picture of a plane with pictures on it, saved', () => {
  test('goes out in pieces with each picture written in where it sits', async () => {
    world.saved = []
    await exportCanvasSvg({
      canvas: readCanvas(
        JSON.stringify({
          nodes: [
            {
              id: 'a',
              type: 'text',
              text: '<img src="pict">',
              x: 0,
              y: 0,
              width: 200,
              height: 100,
            },
          ],
          edges: [],
        }),
      ),
      palette: {},
      path: null,
      root: null,
      name: 'Board.canvas',
      trusted: true,
    })

    const saved = world.saved[0]
    expect(saved?.type).toBe('image/svg+xml')
    expect(await saved?.text()).toContain('<img src="data:image/png;base64,pict"')
  })
})

describe('the colours of a picture leaving the app', () => {
  const dark = { bg: '#0e1013', text: '#eeeeee', ink: '#ffffff' }
  const sheet = document.createElement('style')
  sheet.textContent = "[data-theme='light'] { --bg: #fafbfc; }"
  document.head.append(sheet)

  const drawing = () => ({
    canvas: readCanvas(JSON.stringify({ nodes: [], edges: [] })),
    palette: dark,
    path: null,
    root: null,
    name: 'Plane.canvas',
    trusted: false,
  })
  const saved = async () => {
    await exportCanvasSvg(drawing())
    return (await world.saved.at(-1)?.text()) ?? ''
  }

  test('are the ones Appearance chooses, whichever side the window is on', async () => {
    settings.exportAppearance = 'light'
    const svg = await saved()

    expect(svg).toContain('fill="#fafbfc"')
    expect(svg).not.toContain('#0e1013')
  })

  test('are the window’s where Appearance says as the app is', async () => {
    settings.exportAppearance = 'app'

    expect(await saved()).toContain('fill="#0e1013"')
  })
})

describe('a link that bows out past its cards', () => {
  const bowed = () =>
    readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 1000, y: 0, width: 200, height: 100 },
        ],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'top', toSide: 'top' }],
      }),
    )

  test('is inside the picture, all of it', () => {
    const svg = canvasSvg(bowed(), {}, null, null)
    const [, , top] = /viewBox="(-?\d+) (-?\d+)/.exec(svg) ?? []
    const highest = Math.min(
      ...[...svg.matchAll(/<path d="M [^"]*"/g)].flatMap((path) =>
        [...path[0].matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((pair) => Number(pair[2])),
      ),
    )

    expect(Number(top)).toBeLessThan(-300)
    expect(highest).toBeGreaterThan(-600)
  })

  test('is inside what fitting the plane to the window frames', async () => {
    const { planeBox } = await import('./edits')
    const box = planeBox(bowed())

    expect(box?.y).toBeLessThan(-290)
    expect(box?.y).toBeGreaterThan(-310)
  })
})

describe('a card set as plain lines', () => {
  test('is the weight the card is on the plane, not the weight of a label', () => {
    const svg = canvasSvg(
      readCanvas(
        JSON.stringify({
          nodes: [{ id: 'a', type: 'text', text: 'hello', x: 0, y: 0, width: 200, height: 80 }],
          edges: [],
        }),
      ),
      {},
      null,
      null,
      true,
    )

    expect(svg).toMatch(/<text[^>]*class="words"[^>]*>/)
    expect(svg).toContain('.words { font: 13px')
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

  test('links a picture of the space instead of writing it into the sheet', async () => {
    const page = await printed('<img src="pict" alt="p">')
    expect(page).toMatch(/<img src="blob:[^"]+" alt="p"/)
    expect(page).not.toContain('data:image')
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

describe('a PDF lying on a plane, taken out of the app', () => {
  const drawing = (file: string, ...subpaths: string[]) => ({
    canvas: readCanvas(
      JSON.stringify({
        nodes: (subpaths.length ? subpaths : ['']).map((subpath, at) => ({
          id: `p${String(at)}`,
          type: 'file',
          file,
          ...(subpath ? { subpath } : {}),
          x: at * 300,
          y: 0,
          width: 240,
          height: 320,
        })),
        edges: [],
      }),
    ),
    palette: {},
    path: '/s/Board.canvas',
    root: '/s',
    name: 'Board.canvas',
    trusted: true,
  })

  test('is drawn as its first page in the picture saved', async () => {
    world.saved = []
    await exportCanvasSvg(drawing('Reading.pdf'))
    const saved = (await world.saved[0]?.text()) ?? ''
    expect(saved).toMatch(/<image [^>]*href="data:image\/png;base64,UEFHRQ1A"/)
    expect(saved).not.toContain('>Reading.pdf<')
  })

  test('is drawn as the page it names, each card as its own', async () => {
    world.saved = []
    world.pages = []
    await exportCanvasSvg(drawing('Reading.pdf', '#page=3', '', '#page=3'))
    const saved = (await world.saved[0]?.text()) ?? ''
    expect([...world.pages].sort((a, b) => a - b)).toEqual([1, 3])
    expect(saved.match(/base64,UEFHRQ3A"/g)).toHaveLength(2)
    expect(saved.match(/base64,UEFHRQ1A"/g)).toHaveLength(1)
  })

  test.each([
    ['printed', printCanvas],
    ['made into a PDF', exportCanvasPdf],
  ])('is drawn as its first page when %s, linked and not written in', async (_how, out) => {
    world.printed = []
    await out(drawing('Reading.pdf'))
    const page = world.printed[0] ?? ''
    expect(page).toMatch(/<image [^>]*href="blob:[^"]+"/)
    expect(page).not.toContain('UEFHRQ')
  })

  test('that cannot be read still says its name', async () => {
    world.saved = []
    await exportCanvasSvg(drawing('Gone.pdf'))
    const saved = (await world.saved[0]?.text()) ?? ''
    expect(saved).toContain('Gone.pdf')
    expect(saved).not.toContain('<image')
  })
})
