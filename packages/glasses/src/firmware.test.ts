import { describe, expect, test } from 'vitest'
import { draws, fit, fold, LINE, rightward, rows, ruleOf, SPACE, TICK, width } from './firmware'

/** What the firmware font has and has not, asserted rather than assumed.
 *
 *  Every glyph text mode leans on is checked here, so a change to the font, to
 *  pretext, or to somebody's idea of a good bullet fails a test rather than
 *  quietly drawing nothing on a pair of glasses nobody here can see. */
describe('the firmware font', () => {
  test('sets a fixed 27 pixel line', () => {
    expect(LINE).toBe(27)
  })

  test('has the glyphs the mapping is drawn with', () => {
    for (const one of [
      '─', // rules, and a heading underline
      '═', // a first level heading underline
      '│', // a quote bar
      '•', // a bullet
      '·', // a bullet one level in
      '□', // a task not done
      '■', // a task done
      '▶', // where the cursor is, and a folder shut
      '▼', // a folder open
      '●', // listening
      '…', // where a name was cut
      '¹', // a footnote
      '≡',
      '†',
    ]) {
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
    // To the next stop, not a fixed number: two tabs are four columns.
    expect(fold('\t\tone')).toBe('    one')
    expect(fold('a\tb')).toBe('a b')
  })

  test('has no thin spaces, so nothing tries to letter space with them', () => {
    for (const code of [0x2002, 0x2003, 0x2007, 0x2009, 0x200a]) {
      expect(draws(code), code.toString(16)).toBe(false)
    }
  })
})

/** The promise text mode makes: nothing in a note is silently dropped.
 *
 *  A codepoint the firmware lacks is drawn as nothing at all, so folding is not
 *  a nicety. Every one of these was a hole in a note. */
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
    expect(fold('x⁽²⁾')).toBe('x(²)') // the superscript parentheses are missing
    expect(fold('ⁿ')).toBe('n')
    expect(fold('ﬁt')).toBe('fit')
    expect(fold('№4')).toBe('№4') // this one the font has
    expect(fold('10 µm')).toBe('10 μm') // the micro sign, as a greek mu
  })

  test('keeps an accent the font has, composed or not', () => {
    expect(fold('Zürich, Genève')).toBe('Zürich, Genève')
    // The firmware has no combining marks at all, so a note written on a Mac
    // arrives as a letter and a mark that draws nothing. Composed first.
    expect(fold('Zürich')).toBe('Zürich')
    // And a mark with no precomposed form leaves the letter rather than a box.
    expect(fold('a̧')).toBe('a')
    expect(fold('ǰ')).toBe('j')
  })

  test('says an emoji by name when the emoji font has no glyph', () => {
    // The emoji font has this one.
    expect(fold('😀')).toBe('😀')
    // And not this one, so it reads as what it is called.
    expect(fold('❌')).toBe(':x:')
  })

  test('drops what is meant to be invisible rather than boxing it', () => {
    expect(fold('a​b')).toBe('ab') // zero width space
    expect(fold('❤️')).toBe('❤') // the selector after an emoji
    expect(fold('soft­hyphen')).toBe('softhyphen')
  })

  test('draws a box for anything left, so the reader is told there was one', () => {
    // A private use codepoint: no glyph, no decomposition, no name.
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
    const page = 'The quick brown fox jumps over the lazy dog. '.repeat(60)
    const at = performance.now()
    for (let round = 0; round < 100; round++) fold(page)
    const each = (performance.now() - at) / 100

    // 2,700 characters, a hundred times. A page turn folds one page.
    expect(each).toBeLessThan(4)
  })
})

/** Measuring, which is the whole of how a page knows where it ends. */
describe('measuring as the firmware sets it', () => {
  test('measures a folded string, not the one it was given', () => {
    // Unfolded, a backtick is nothing and three of them are zero pixels wide.
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
    // Within one space of the edge, which is five pixels of 576.
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
