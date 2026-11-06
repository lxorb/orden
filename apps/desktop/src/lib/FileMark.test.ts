import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

const chosen: Record<string, string | null> = {}
const tints: Record<string, string | null> = {}
const papers = new Set<string>()
const brands: Record<string, string> = {}

vi.mock('./chosen-icon', () => ({
  chosenIcon: (path: string) => chosen[path] ?? null,
  chosenTint: (path: string) => tints[path] ?? null,
  faviconFor: () => null,
  sourceMark: (mark: string, path: string | undefined, url?: string) => ({
    mark: mark === 'pages' && path !== undefined && papers.has(path) ? 'pdf' : mark,
    icon: mark === 'web' && url ? (brands[url] ?? null) : null,
  }),
}))

const { iconLibrary } = await import('./icon-library.svelte')
const { loadIcons } = await import('./icons')
const { MARKS } = await import('./file-mark')
type Mark = keyof typeof MARKS
const FileMark = (await import('./FileMark.svelte')).default

iconLibrary.set = await loadIcons()

function strokes(icon: readonly (readonly [string, Record<string, unknown>])[]): string[] {
  return icon.flatMap(([, attrs]) => (typeof attrs.d === 'string' ? [attrs.d] : []))
}

function drawn(mark: Mark, path?: string): string {
  return render(FileMark, { props: path === undefined ? { mark } : { mark, path } }).body
}

const rocket = strokes(iconLibrary.shape('rocket') ?? [])

describe('a row that chose an icon of its own', () => {
  test('a note wears it in place of the page', () => {
    chosen['Plan.md'] = 'rocket'
    const body = drawn('note', 'Plan.md')

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.note)[0])
  })

  test('a folder with no note of its own wears it in place of the plain page', () => {
    chosen.Work = 'rocket'
    const body = drawn('file', 'Work')

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.file)[0])
  })

  test('a canvas wears it in place of the two cards', () => {
    chosen['Board.canvas'] = 'rocket'
    const body = drawn('canvas', 'Board.canvas')

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.canvas)[0])
  })

  test('however the name was spelled in the file or the map', () => {
    chosen.Work = 'LiRocket'
    chosen['Board.canvas'] = 'Rocket'

    for (const stroke of rocket) {
      expect(drawn('file', 'Work')).toContain(stroke)
      expect(drawn('canvas', 'Board.canvas')).toContain(stroke)
    }
  })

  test('or is an emoji, set in the same box instead of stroked', () => {
    chosen.Work = '🚀'
    chosen['Board.canvas'] = '🚀'

    for (const path of ['Work', 'Board.canvas']) {
      const body = drawn(path === 'Work' ? 'file' : 'canvas', path)
      expect(body).toContain('🚀')
      expect(body).not.toContain('<svg')
    }
  })
})

describe('an icon with a colour on it', () => {
  test('is drawn in that colour rather than in the foreground', () => {
    chosen.Work = 'rocket'
    tints.Work = 'violet'
    const body = drawn('file', 'Work')

    expect(body).toMatch(/style="[^"]*color:/)
    tints.Work = null
  })

  test('and a colour nothing here knows is no colour at all', () => {
    chosen.Work = 'rocket'
    tints.Work = 'chartreuse'
    expect(drawn('file', 'Work')).not.toMatch(/style="[^"]*color:/)
    tints.Work = null
  })

  test('an emoji takes none', () => {
    chosen.Work = '🚀'
    tints.Work = 'violet'
    expect(drawn('file', 'Work')).not.toMatch(/style="[^"]*color:/)
    tints.Work = null
  })
})

describe('an emoji s outline', () => {
  const outline = '<path fill="currentColor" d="M1 1h30v30H1z"/>'
  const one = (body: string) => ({
    entries: [],
    groups: [],
    shape: () => ({ kind: 'drawn' as const, body, box: '0 0 32 32' }),
  })

  test('is drawn in the colour on it', () => {
    const before = iconLibrary.loaded
    iconLibrary.loaded = { ...before, 'fluent-emoji-high-contrast': one(outline) }
    chosen.Work = 'fluent-emoji-high-contrast:thinking-face'
    tints.Work = 'violet'
    const body = drawn('file', 'Work')

    expect(body).toContain('M1 1h30v30H1z')
    expect(body).toMatch(/<svg[^>]*class="[^"]*drawn[^"]*"[^>]*style="[^"]*color:/)
    expect(body).toMatch(/class="[^"]*mark[^"]*quiet/)
    tints.Work = null
    iconLibrary.loaded = before
  })

  test('and a logo takes none', () => {
    const before = iconLibrary.loaded
    iconLibrary.loaded = { ...before, 'simple-icons': one(outline) }
    chosen.Work = 'simple-icons:github'
    tints.Work = 'violet'
    expect(drawn('file', 'Work')).not.toMatch(/style="[^"]*color:/)
    tints.Work = null
    iconLibrary.loaded = before
  })
})

describe('a row that chose nothing', () => {
  test('wears the mark its kind wears', () => {
    for (const mark of ['note', 'canvas', 'file', 'pdf'] as const) {
      const body = drawn(mark, `nothing chose ${mark}`)
      for (const stroke of strokes(MARKS[mark])) expect(body, mark).toContain(stroke)
    }
  })

  test('and so does a caller that knows a name but no path', () => {
    const body = drawn('file')
    for (const stroke of strokes(MARKS.file)) expect(body).toContain(stroke)
  })

  test('and so does a row whose icon the set does not hold', () => {
    chosen.Work = 'not-an-icon-anybody-drew'
    const body = drawn('file', 'Work')

    for (const stroke of strokes(MARKS.file)) expect(body).toContain(stroke)
  })
})

describe('a page note', () => {
  test('made from a PDF wears the PDF mark', () => {
    papers.add('Lecture.pages')
    const body = drawn('pages', 'Lecture.pages')

    for (const stroke of strokes(MARKS.pdf)) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.pages)[0])
  })

  test('started blank wears its own', () => {
    const body = drawn('pages', 'Sketches.pages')

    for (const stroke of strokes(MARKS.pages)) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.pdf)[0])
  })

  test('an icon it chose still comes first', () => {
    papers.add('Chosen.pages')
    chosen['Chosen.pages'] = 'rocket'
    const body = drawn('pages', 'Chosen.pages')

    for (const stroke of rocket) expect(body).toContain(stroke)
  })
})

describe('a website with no favicon', () => {
  const logo = '<path fill="currentColor" d="M3 3h18v18H3z"/>'
  iconLibrary.loaded = {
    ...iconLibrary.loaded,
    'simple-icons': {
      entries: [],
      groups: [],
      shape: (name) => (name === 'github' ? { kind: 'drawn', body: logo, box: '0 0 24 24' } : null),
    },
  }

  const site = (url: string) => render(FileMark, { props: { mark: 'web', url } }).body

  test('wears its brand s logo', () => {
    brands['https://github.com/'] = 'simple-icons:github'
    const body = site('https://github.com/')

    expect(body).toContain('M3 3h18v18H3z')
    expect(body).not.toContain(strokes(MARKS.web)[0])
  })

  test('and the globe where its brand is not one the set holds', () => {
    brands['https://example.org/'] = 'simple-icons:example'
    expect(site('https://example.org/')).toContain(strokes(MARKS.web)[0])
  })
})
