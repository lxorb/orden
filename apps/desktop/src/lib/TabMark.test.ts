import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'svelte/server'
import type { TabKind } from './workspace/documents.svelte'

const chosen: Record<string, string | null> = {}
const marks: Record<string, string | null> = {}

vi.mock('./chosen-icon', () => ({
  chosenIcon: (path: string) => chosen[path] ?? null,
  chosenTint: () => null,
  faviconFor: (path: string) => marks[path] ?? null,
  wearsChosen: (path: string | null) => !!path && !!chosen[path],
  sourceMark: (mark: string) => ({ mark, icon: null }),
}))

const { iconLibrary } = await import('./icon-library.svelte')
const { loadIcons } = await import('./ui-kit/src/icons')
const { MARKS } = await import('./file-mark')
const { GRAPH_MARK } = await import('./panel-marks')
const { NoteDoc, Tab } = await import('./workspace/documents.svelte')
const { pages } = await import('./web-tab/pages.svelte')
const { writeShortcut } = await import('@orden/scan/shortcut')
const TabMark = (await import('./TabMark.svelte')).default

iconLibrary.set = await loadIcons()

function strokes(icon: readonly (readonly [string, Record<string, unknown>])[]): string[] {
  return icon.flatMap(([, attrs]) => (typeof attrs.d === 'string' ? [attrs.d] : []))
}

const rocket = strokes(iconLibrary.shape('rocket') ?? [])

function tabFor(kind: TabKind, path: string | null, text = ''): InstanceType<typeof Tab> {
  const doc = new NoteDoc(
    { kind, path, name: path?.split('/').at(-1) ?? 'Untitled', text, dirty: false },
    () => undefined,
  )

  return new Tab(doc, 'pane')
}

function drawn(tab: InstanceType<typeof Tab>): string {
  return render(TabMark, { props: { tab } }).body
}

const SITE = 'https://svelte.dev/docs'
const FAVICON = 'https://svelte.dev/favicon.png'
const FOUND = 'https://svelte.dev/found.png'

function shortcut(icon: string | null): string {
  return writeShortcut(SITE, 'Svelte docs', new Date('2026-09-13T08:00:00.000Z'), null, icon)
}

describe('a tab wearing the mark of what it holds', () => {
  test('a note that chose an icon wears it, the way its row does', () => {
    chosen['Plan.md'] = 'rocket'
    const body = drawn(tabFor('note', 'Plan.md', '# Plan'))

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.note)[0])
  })

  test('and so do the canvas, the page note and the PDF', () => {
    for (const [kind, path] of [
      ['canvas', 'Board.canvas'],
      ['pages', 'Lecture.pages'],
      ['pdf', 'Paper.pdf'],
    ] as const) {
      chosen[path] = 'rocket'
      const body = drawn(tabFor(kind, path))

      for (const stroke of rocket) expect(body, kind).toContain(stroke)
      expect(body, kind).not.toContain(strokes(MARKS[kind])[0])
    }
  })

  test('and a file that chose nothing wears its kind s own drawing', () => {
    for (const [kind, path] of [
      ['note', 'Bare.md'],
      ['canvas', 'Bare.canvas'],
      ['pages', 'Bare.pages'],
      ['pdf', 'Bare.pdf'],
    ] as const) {
      const body = drawn(tabFor(kind, path))

      for (const stroke of strokes(MARKS[kind])) expect(body, kind).toContain(stroke)
      for (const stroke of rocket) expect(body, kind).not.toContain(stroke)
    }
  })

  test('and a note with no file yet wears the page with writing on it', () => {
    chosen[''] = 'rocket'
    const body = drawn(tabFor('note', null, '# draft'))

    for (const stroke of strokes(MARKS.note)) expect(body).toContain(stroke)
    for (const stroke of rocket) expect(body).not.toContain(stroke)
  })

  test('and the graph is the space s own picture', () => {
    expect(drawn(tabFor('graph', null))).toContain(GRAPH_MARK)
  })
})

describe('a tab holding a website', () => {
  test('wears the site s own picture, out of the file, before any page has loaded', () => {
    const body = drawn(tabFor('web', 'Svelte docs.url', shortcut(FAVICON)))

    expect(body).toContain(`src="${FAVICON}"`)
    for (const stroke of strokes(MARKS.web)) expect(body).not.toContain(stroke)
  })

  test('and the globe where neither the file nor the page has one', () => {
    const body = drawn(tabFor('web', 'Svelte docs.url', shortcut(null)))

    for (const stroke of strokes(MARKS.web)) expect(body).toContain(stroke)
    expect(body).not.toContain('<img')
  })

  test('and what the row draws for it where this window s own file says nothing', () => {
    marks['Elsewhere.url'] = FOUND
    const body = drawn(tabFor('web', 'Elsewhere.url', shortcut(null)))

    expect(body).toContain(`src="${FOUND}"`)
    for (const stroke of strokes(MARKS.web)) expect(body).not.toContain(stroke)
  })

  test('and turns instead of either while the page is on its way', () => {
    const tab = tabFor('web', 'Svelte docs.url', shortcut(FAVICON))
    pages.of(tab.id).loading = true

    const body = drawn(tab)
    expect(body).toContain('turning')
    expect(body).not.toContain('<img')
  })

  test('while a note is its page whatever any page is doing', () => {
    const tab = tabFor('note', 'Bare.md', '# Plan')
    pages.of(tab.id).loading = true

    const body = drawn(tab)
    expect(body).not.toContain('turning')
    for (const stroke of strokes(MARKS.note)) expect(body).toContain(stroke)
  })
})

describe('one box for every kind', () => {
  const source = readFileSync(join(import.meta.dirname, './TabMark.svelte'), 'utf8')
  const mark = readFileSync(join(import.meta.dirname, './FileMark.svelte'), 'utf8')

  test('is the box the file list draws a mark in', () => {
    for (const rule of ['width: var(--icon-md)', 'height: var(--icon-md)']) {
      expect(mark).toContain(rule)
      expect(source).toContain(rule)
    }
  })

  test('and one weight, across the two grids the marks are drawn on', () => {
    expect(mark).toContain('stroke-width: 1.6')
    expect(source).toContain('stroke-width: 1.6')
    expect(source).toContain('stroke-width: calc(1.6 * 13 / 24)')
  })

  test('and the turn stops where movement is not wanted', () => {
    const style = source.slice(source.indexOf('<style>'))
    expect(style).toContain('@media (prefers-reduced-motion: reduce)')
    expect(style).toMatch(/prefers-reduced-motion[\s\S]{0,200}animation: none/)
  })
})
