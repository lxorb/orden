import { describe, expect, test } from 'vitest'
import { CODE_PALETTES, type LigatureScope } from '@nib/editor'
import { blocksOf, fenceLanguagesIn, INDENT_STEP } from './blocks'
import { fenceSpans } from './code'
import { layoutNote, type Line, type LayoutOptions, type Page, pageAt } from './layout'
import { ruler } from './measure'
import { CHARACTERS_PER_LINE, TEXT_HEIGHT, TEXT_WIDTH } from './panel'

const PALETTE = CODE_PALETTES[0]!

function options(scope: LigatureScope = 'off'): LayoutOptions {
  return {
    scope,
    palette: PALETTE,
    measure: ruler(),
    // No parser: a fence comes out as plain lines, which is what an unknown
    // language looks like. The greys are under test in grey.test.ts.
    fence: (code) => fenceSpans(code),
  }
}

const pages = (source: string, scope?: LigatureScope) => layoutNote(source, options(scope))

/** Every word on a page, in reading order. */
const words = (page: Page) =>
  page.lines.flatMap((line) => line.placed.map((one) => one.run.over ?? one.run.text)).join('')

const lineText = (line: Line) => line.placed.map((one) => one.run.over ?? one.run.text).join('')

const PROSE = Array.from(
  { length: 60 },
  (_one, at) => `Paragraph ${at} with enough words in it to run past the end of one line easily.`,
).join('\n\n')

describe('a note as pages', () => {
  test('sets prose across the whole width', () => {
    const [first] = pages(
      'This is a sentence that is comfortably longer than one line of a panel that is five hundred and fifty six pixels wide, so it has to wrap.',
    )
    const full = first?.lines.filter((line) => line.placed.length > 3) ?? []
    expect(full.length).toBeGreaterThan(1)

    // Every wrapped line but the last reaches near the far edge: the note is set
    // across the panel, not down a column in the middle of it.
    for (const line of full.slice(0, -1)) {
      const end = Math.max(...line.placed.map((one) => one.x + one.width))
      expect(end).toBeGreaterThan(TEXT_WIDTH * 0.85)
    }
  })

  test('starts every line at the left edge', () => {
    for (const page of pages(PROSE)) {
      for (const line of page.lines) {
        expect(line.placed[0]?.x ?? 0).toBeLessThanOrEqual(0)
      }
    }
  })

  test('puts sixty to eighty characters on a line', () => {
    const filled = pages(PROSE)
      .flatMap((page) => page.lines)
      .map(lineText)
      // The last line of a paragraph is short by definition.
      .filter((text) => text.length > 20)

    const most = Math.max(...filled.map((text) => text.length))
    expect(most).toBeGreaterThanOrEqual(CHARACTERS_PER_LINE.least)
    expect(most).toBeLessThanOrEqual(CHARACTERS_PER_LINE.most)
  })

  test('fills a page and no more', () => {
    for (const page of pages(PROSE)) {
      const used = page.lines.reduce((sum, line) => sum + line.height, 0)
      expect(used).toBeLessThanOrEqual(TEXT_HEIGHT)
    }
    // And uses most of it: a page half empty means the filler gave up early.
    const first = pages(PROSE)[0]!
    const used = first.lines.reduce((sum, line) => sum + line.height, 0)
    expect(used).toBeGreaterThan(TEXT_HEIGHT * 0.8)
  })

  test('loses not one word of the note', () => {
    const all = pages(PROSE).map(words).join('')
    for (let at = 0; at < 60; at++) expect(all).toContain(`Paragraph ${at}`)
  })

  test('never opens a page with a glued line', () => {
    for (const page of pages(`# A heading\n\n${PROSE}`)) {
      expect(page.lines[0]?.glue, `page ${page.index}`).toBe(false)
    }
  })

  test('answers with one page for a note with nothing in it', () => {
    expect(pages('')).toEqual([])
    expect(pages('one word')).toHaveLength(1)
  })
})

const FENCE = [
  '```js',
  ...Array.from({ length: 40 }, (_one, at) => `const line${at} = ${at}`),
  '```',
].join('\n')

describe('a fence across a page break', () => {
  test('breaks between its lines and never inside one', () => {
    const long = `x = ${'a'.repeat(400)}`
    const source = ['```js', 'short', long, 'short again', '```'].join('\n')
    const out = pages(source)

    // The long line wraps into several rows, all but the first glued, so the
    // whole line moves together whenever it does not fit.
    for (const page of out) {
      const rows = page.lines
      rows.forEach((line, at) => {
        if (at === 0) expect(line.glue).toBe(false)
      })
    }

    // And its characters all sit on one page.
    const holding = out.filter((page) => words(page).includes('aaaa'))
    expect(holding).toHaveLength(1)
  })

  test('spreads a long fence over pages, in order', () => {
    const out = pages(FENCE)
    expect(out.length).toBeGreaterThan(1)

    const all = out.map(words).join('')
    for (let at = 0; at < 40; at++) expect(all).toContain(`line${at}`)
    expect(all.indexOf('line0')).toBeLessThan(all.indexOf('line39'))
  })

  test('draws its ground behind every line of it', () => {
    for (const page of pages(FENCE)) {
      for (const line of page.lines) {
        expect(line.fills.some((fill) => fill.width > TEXT_WIDTH * 0.9)).toBe(true)
      }
    }
  })
})

describe('the map from a page to a place in the note', () => {
  test('runs forwards and covers the whole note', () => {
    const out = pages(PROSE)
    expect(out[0]?.from).toBe(0)
    expect(out.at(-1)?.to).toBe(PROSE.length)

    for (let at = 1; at < out.length; at++) {
      expect(out[at]!.from).toBeGreaterThan(out[at - 1]!.from)
      expect(out[at - 1]!.to).toBe(out[at]!.from)
    }
  })

  test('lands on the page a position is shown on', () => {
    const out = pages(PROSE)
    for (const page of out) {
      expect(pageAt(out, page.from)).toBe(page.index)
      expect(pageAt(out, page.to - 1)).toBe(page.index)
    }
  })

  test('counts from the start of the file, front matter and all', () => {
    const source = `---\ntitle: A note\n---\n\n# Heading\n\nSome words.`
    const [first] = pages(source)
    expect(first?.from).toBe(source.indexOf('# Heading'))
  })

  test('answers for a position past the end', () => {
    const out = pages(PROSE)
    expect(pageAt(out, PROSE.length * 2)).toBe(out.length - 1)
  })
})

describe('what a page is made of', () => {
  test('gives a heading its own size and weight', () => {
    const [page] = pages('# Big\n\n## Smaller\n\nplain')
    const sizes = (page?.lines ?? []).map((line) => line.placed[0]?.run.style.size ?? 0)
    expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0)
    expect(sizes[1]).toBeGreaterThan(sizes[2] ?? 0)
    expect(page?.lines[0]?.placed[0]?.run.style.weight).toBe('bold')
  })

  test('hangs a bullet outside the words of its item', () => {
    const [page] = pages('- one\n- two')
    const first = page?.lines[0]
    expect(first?.placed[0]?.run.text).toBe('•')
    // The bullet sits in the indent the item is set to, so the words of every
    // line of the item line up and the bullet hangs to their left.
    expect(first?.placed[0]?.x).toBeLessThan(first!.placed[1]!.x)
    expect(first?.placed[1]?.x).toBe(INDENT_STEP)
  })

  test('numbers an ordered list from where it starts', () => {
    const [page] = pages('3. three\n4. four')
    expect(page?.lines[0]?.placed[0]?.run.text).toBe('3.')
    expect(page?.lines[1]?.placed[0]?.run.text).toBe('4.')
  })

  test('marks a task by its box', () => {
    const [page] = pages('- [ ] to do\n- [x] done')
    expect(page?.lines[0]?.placed[0]?.run.text).toBe('☐')
    expect(page?.lines[1]?.placed[0]?.run.text).toBe('☑')
  })

  test('draws a bar beside a quote, one per level', () => {
    const [page] = pages('> quoted\n>\n> > deeper')
    const bars = page?.lines.map((line) => line.fills.filter((fill) => fill.width === 2).length)
    expect(bars?.[0]).toBe(1)
    expect(bars?.at(-1)).toBe(2)
  })

  test('draws a table as a grid, one line per row', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
    const [page] = pages(source)
    expect(page?.lines).toHaveLength(3)
    // A rule under every row and one line between the two columns.
    for (const line of page?.lines ?? []) {
      expect(line.fills.filter((fill) => fill.width === 1)).toHaveLength(1)
      expect(line.fills.some((fill) => fill.height <= 2 && fill.width > 100)).toBe(true)
    }
    expect(page?.lines[0]?.placed[0]?.run.style.weight).toBe('bold')
    expect(page?.lines[1]?.glue).toBe(true)
  })

  /** A column used to be floored to a whole pixel after being measured, which
   *  left it a fraction narrower than its own content. The widest cell in every
   *  column then wrapped, and a wrapped cell is a cut cell, so a table that had
   *  room to spare still came out as "Contai…" and "Millisecon…". */
  test('gives a column the width its content needs', () => {
    const source =
      '| Container | Pixels | Milliseconds |\n| --- | --- | --- |\n| Image | 288 | 185 |\n| Text | 576 | 83 |'
    const [page] = pages(source)
    const shown = (page?.lines ?? []).map(lineText).join(' ')

    expect(shown).not.toContain('…')
    expect(shown).toContain('Container')
    expect(shown).toContain('Milliseconds')
  })

  test('shrinks the widest column first when the row will not fit', () => {
    // One column of sentences and two of small numbers. The numbers are not
    // squeezed to make room for the sentences: they already fit.
    const long = 'a sentence that is far too long to sit in a column beside anything else at all'
    const source = `| ${long} | 288 | 185 |\n| --- | --- | --- |\n| ${long} | 576 | 83 |`
    const [page] = pages(source)
    const shown = (page?.lines ?? []).map(lineText).join(' ')

    // The numbers survive whole; only the column that could not fit is cut.
    expect(shown).toContain('288')
    expect(shown).toContain('185')
    expect(shown).toContain('576')
    expect(shown).toContain('83')
    expect(shown).toContain('…')
  })

  test('turns emphasis into weight and slant', () => {
    const [page] = pages('plain **bold** *slanted* ~~gone~~ `code`')
    const runs = page?.lines.flatMap((line) => line.placed.map((one) => one.run)) ?? []
    const of = (text: string) => runs.find((run) => run.text === text)

    expect(of('bold')?.style.weight).toBe('bold')
    expect(of('slanted')?.style.slant).toBe('italic')
    expect(of('gone')?.style.strike).toBe(true)
    expect(of('code')?.style.family).toBe('mono')
    expect(of('code')?.box).toBeDefined()
  })

  test('underlines a link and a wikilink, and shows what they said', () => {
    const [page] = pages('see [the docs](https://example.com) and [[Note|that one]]')
    const runs = page?.lines.flatMap((line) => line.placed.map((one) => one.run)) ?? []

    expect(runs.find((run) => run.text === 'docs')?.style.underline).toBe(true)
    expect(runs.find((run) => run.text === 'that')?.style.underline).toBe(true)
    // The address is not shown; the words are.
    expect(runs.map((run) => run.text).join('')).not.toContain('example.com')
  })

  test('draws a horizontal rule as a rule', () => {
    const [page] = pages('above\n\n---\n\nbelow')
    const rule = page?.lines.find((line) => !line.placed.length)
    expect(rule?.fills.some((fill) => fill.height === 1 && fill.width > 100)).toBe(true)
  })

  test('names a callout before its words', () => {
    const [page] = pages('> [!warning]\n> Mind the step.')
    expect(lineText(page!.lines[0]!)).toBe('Warning')
    expect(lineText(page!.lines[1]!)).toContain('Mind')
  })

  test('shows a formula as a formula, with its source to fall back on', () => {
    const [page] = pages('$$\nx^2\n$$\n\nand $y_1$ inline')
    const runs = page?.lines.flatMap((line) => line.placed.map((one) => one.run)) ?? []
    const maths = runs.filter((run) => run.math)

    expect(maths).toHaveLength(2)
    expect(maths[0]?.math?.display).toBe(true)
    expect(maths[1]?.math?.display).toBe(false)
    expect(maths[0]?.text).toBe('x^2')
  })
})

describe('the glyphs on a page', () => {
  test('are drawn over the room the characters take', () => {
    const [page] = pages('a -> b in prose', 'all')
    const glyph = page?.lines[0]?.placed.find((one) => one.run.over === '->')
    expect(glyph?.run.text).toBe('→')
    // Two characters wide, not one, so a fence's columns still line up.
    expect(glyph?.width).toBeCloseTo(ruler().width('->', glyph!.run.style))
  })

  test('reach a fence under the code scope and leave prose alone', () => {
    const source = 'prose -> here\n\n```\ncode -> here\n```'
    const drawn = (scope: LigatureScope) =>
      pages(source, scope)
        .flatMap((page) => page.lines.flatMap((line) => line.placed.map((one) => one.run)))
        .filter((run) => run.over !== undefined)
        .map((run) => run.text)

    expect(drawn('off')).toEqual([])
    expect(drawn('code')).toEqual(['→'])
    expect(drawn('all')).toEqual(['→', '→'])
  })
})

describe('what a note asks for before it can be set', () => {
  test('names every language its fences use', () => {
    const source = '```ts\na\n```\n\n```python\nb\n```\n\n```\nc\n```'
    expect(fenceLanguagesIn(source).sort()).toEqual(['python', 'ts'])
  })

  test('walks a note into blocks in reading order', () => {
    const source = '# One\n\ntext\n\n- item\n\n```\nfence\n```'
    const kinds = blocksOf(source, options()).map((block) => block.kind)
    expect(kinds).toEqual(['heading', 'text', 'item', 'code'])
  })
})
