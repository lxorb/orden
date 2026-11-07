import { measureTextWrap } from '@evenrealities/pretext'
import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../scripts/growth'
import {
  draws,
  fit,
  fold,
  rightward,
  rows,
  ruleOf,
  SPACE,
  TICK,
  width,
  workDone,
  wrap,
} from './firmware'
import { BODY_INNER, LINE } from './panel'

describe('the firmware font', () => {
  test('sets a fixed 27 pixel line', () => {
    expect(LINE).toBe(27)
  })

  test('has the glyphs the mapping is drawn with', () => {
    for (const one of ['─', '═', '│', '•', '·', '□', '■', '▶', '▼', '●', '…', '¹', '≡', '†']) {
      expect(draws(one.codePointAt(0) ?? 0), one).toBe(true)
    }
  })

  test('has no backtick, which is why a fence is written with a quote', () => {
    expect(draws(0x60)).toBe(false)
    expect(draws(TICK.codePointAt(0) ?? 0)).toBe(true)
    expect(fold('```ts')).toBe(`${TICK.repeat(3)}ts`)
  })

  test('has none of the check marks or ballot boxes a task list is written with', () => {
    for (const one of ['✓', '✔', '☐', '☑', '✗']) {
      expect(draws(one.codePointAt(0) ?? 0), one).toBe(false)
    }
  })

  test('has no tab, so one is spent as spaces', () => {
    expect(draws(9)).toBe(false)
    expect(fold('\tone')).toBe('  one')
    expect(fold('\t\tone')).toBe('    one')
    expect(fold('a\tb')).toBe('a b')
  })

  test('has no thin spaces, so nothing tries to letter space with them', () => {
    for (const code of [0x2002, 0x2003, 0x2007, 0x2009, 0x200a]) {
      expect(draws(code), code.toString(16)).toBe(false)
    }
  })
})

describe('folding a note to what the font can draw', () => {
  test('leaves what the font has exactly as it is', () => {
    expect(fold('The quick brown fox, 1234 (five) - six.')).toBe(
      'The quick brown fox, 1234 (five) - six.',
    )
  })

  test('keeps newlines, which are the one control the container reads', () => {
    expect(fold('one\ntwo')).toBe('one\ntwo')
  })

  test('draws a check mark as the tick the font has', () => {
    expect(fold('done ✓')).toBe('done √')
  })

  test('draws a ballot box as a box', () => {
    expect(fold('☐ ☑')).toBe('□ ■')
  })

  test('rescues a whole class through a compatibility decomposition', () => {
    expect(fold('x⁽²⁾')).toBe('x(²)')
    expect(fold('ⁿ')).toBe('n')
    expect(fold('ﬁt')).toBe('fit')
    expect(fold('№4')).toBe('№4')
    expect(fold('10 µm')).toBe('10 μm')
  })

  test('keeps an accent the font has, composed or not', () => {
    expect(fold('Zürich, Genève')).toBe('Zürich, Genève')
    expect(fold('Zürich')).toBe('Zürich')
    expect(fold('a̧')).toBe('a')
    expect(fold('ǰ')).toBe('j')
  })

  test('says an emoji by name when the emoji font has no glyph', () => {
    expect(fold('😀')).toBe('😀')
    expect(fold('❌')).toBe(':x:')
  })

  test('drops what is meant to be invisible rather than boxing it', () => {
    expect(fold('a​b')).toBe('ab')
    expect(fold('❤️')).toBe('❤')
    expect(fold('soft­hyphen')).toBe('softhyphen')
  })

  test('draws a box for anything left, so the reader is told there was one', () => {
    expect(fold('ab')).toBe('a□b')
  })

  test('never answers with a character the font cannot draw', () => {
    const everything = [
      '# Heading',
      '- [ ] a task ✓ ✗',
      '```ts',
      'const a = 1 // ☐',
      '```',
      '> quoted ‣ text',
      'maths: ∀x ∈ ℝ, x² ≥ 0',
      'emoji: 😀 ❌ ⭐ ❤️',
      'accents: Zürich Genève ǰ',
      'spaces: a b c',
      'tabs:\tone\ttwo',
      'ticks: `code` and ```',
      'arrows: → ⇒ ↵ ⏎',
      'boxes: ░ ▓ ║ ╔ ┄ ▸',
      'CJK: 日本語のノート',
      'Cyrillic: заметка',
    ].join('\n')

    for (const one of fold(everything)) {
      if (one === '\n') continue
      expect(draws(one.codePointAt(0) ?? 0), JSON.stringify(one)).toBe(true)
    }
  })

  test('folds a page of prose in well under a frame', () => {
    const page = 'The quick brown fox ╬ jumps over the ┋ lazy dog ◃. '.repeat(60)

    workDone()
    fold(page)
    const first = workDone()

    for (let round = 0; round < 100; round++) fold(page)
    const rest = workDone()

    expect(first.folded).toBe(page.length)
    expect(rest.folded).toBe(page.length * 100)
    expect(first.measured).toBe(0)
    expect(rest.measured).toBe(0)

    expect(first.instead).toBeLessThanOrEqual(3)
    expect(rest.instead).toBe(0)

    const unit = 'The quick brown fox ╬ jumps over the ┋ lazy dog ◃. '
    expect(growth((count) => fold(unit.repeat(count)), 60)).toBeLessThan(GROWS_AT_MOST)
  })
})

describe('measuring as the firmware sets it', () => {
  test('measures a folded string, not the one it was given', () => {
    expect(width('```')).toBeGreaterThan(0)
  })

  test('gives an empty line a line of its own', () => {
    expect(rows('', 560)).toBe(1)
    expect(rows('one line', 560)).toBe(1)
  })

  test('counts the lines a long line wraps to', () => {
    expect(rows('x'.repeat(200), 560)).toBeGreaterThan(1)
    expect(rows('one\ntwo\nthree', 560)).toBe(3)
  })

  test('cuts a name to fit and marks where it was cut', () => {
    expect(fit('short', 560)).toBe('short')

    const cut = fit('a name far too long to fit in the space it has been given', 100)
    expect(cut.endsWith('…')).toBe(true)
    expect(width(cut)).toBeLessThanOrEqual(100)
  })

  test('pushes a page number against the right hand edge', () => {
    const line = rightward('3/12', 560)

    expect(line.trimStart()).toBe('3/12')
    expect(width(line)).toBeLessThanOrEqual(560)
    expect(width(line)).toBeGreaterThan(560 - SPACE - 1)
  })

  test('leaves a line alone when it already fills the width', () => {
    const long = 'x'.repeat(200)
    expect(rightward(long, 560)).toBe(long)
  })

  test('makes a rule that reaches exactly as far as a full line of text', () => {
    const rule = ruleOf('─', 560)

    expect(rule.length).toBe(28)
    expect(width(rule)).toBe(560)
  })

  test('makes a rule of at least one glyph, however little room there is', () => {
    expect(ruleOf('─', 4)).toBe('─')
  })
})

describe('a word too long for a row', () => {
  const URL = `https://example.org/${'abcdefghij'.repeat(20)}`

  test.each([
    ['a quote', '│ ', `│ link${'x'.repeat(200)}`],
    ['a list', '   ', `• ${URL}`],
    ['a quote with a link', '│ ', `│ ${URL}`],
  ])('in %s, is cut into rows the firmware keeps to one line each', (_what, hang, text) => {
    for (const row of wrap(text, BODY_INNER, hang)) {
      expect(measureTextWrap(row, BODY_INNER).lineCount, row).toBe(1)
    }
  })

  test('starts beside its bullet or quote bar, not on the row after it', () => {
    expect(wrap(`• ${URL}`, BODY_INNER, '   ')[0]).toMatch(/^• https/)
    expect(wrap(`│ ${URL}`, BODY_INNER, '│ ')[0]).toMatch(/^│ https/)
  })

  test('keeps the space before the word after it', () => {
    const rows = wrap(`see ${'x'.repeat(120)} after this`, BODY_INNER)

    expect(rows.at(-1)).toMatch(/x after this$/)
  })
})
