import { describe, expect, test } from 'vitest'
import { LIGATURES } from '@nib/editor'
import { BODY } from './style'
import { drawsGlyphs, type Run, textRuns, withGlyphs } from './runs'

/** The words a list of runs draws, which is not the words it stands for. */
const drawn = (runs: readonly Run[]) => runs.map((run) => run.text).join('')
/** What the note actually says, glyphs put back. */
const kept = (runs: readonly Run[]) => runs.map((run) => run.over ?? run.text).join('')

describe('the glyphs the panel draws over a run', () => {
  test('uses the editor’s own table', () => {
    // Not a copy of it: every entry in the table comes out as its glyph.
    for (const [run, glyph] of Object.entries(LIGATURES)) {
      expect(drawn(withGlyphs(`a ${run} b`, BODY))).toBe(`a ${glyph} b`)
    }
  })

  test('keeps the characters the glyph stands for', () => {
    const runs = withGlyphs('if (a <= b) return a -> b', BODY)
    expect(kept(runs)).toBe('if (a <= b) return a -> b')
    expect(drawn(runs)).toBe('if (a ≤ b) return a → b')
  })

  test('takes the longest run first', () => {
    expect(drawn(withGlyphs('<=>', BODY))).toBe('⇔')
    expect(drawn(withGlyphs('<==>', BODY))).toBe('⟺')
    expect(drawn(withGlyphs('<-->', BODY))).toBe('⟷')
  })

  test('leaves a run with nothing in it as nothing', () => {
    expect(withGlyphs('', BODY)).toEqual([])
  })
})

describe('the ligature scope', () => {
  test('off draws nothing anywhere', () => {
    expect(drawsGlyphs('off', true)).toBe(false)
    expect(drawsGlyphs('off', false)).toBe(false)
    expect(drawn(textRuns('a -> b', BODY, { scope: 'off', code: true }))).toBe('a -> b')
    expect(drawn(textRuns('a -> b', BODY, { scope: 'off', code: false }))).toBe('a -> b')
  })

  test('code draws in a fence and in a span, and not in prose', () => {
    expect(drawsGlyphs('code', true)).toBe(true)
    expect(drawsGlyphs('code', false)).toBe(false)
    expect(drawn(textRuns('a -> b', BODY, { scope: 'code', code: true }))).toBe('a → b')
    expect(drawn(textRuns('a -> b', BODY, { scope: 'code', code: false }))).toBe('a -> b')
  })

  test('all draws everywhere', () => {
    expect(drawsGlyphs('all', true)).toBe(true)
    expect(drawsGlyphs('all', false)).toBe(true)
    expect(drawn(textRuns('a -> b', BODY, { scope: 'all', code: true }))).toBe('a → b')
    expect(drawn(textRuns('a -> b', BODY, { scope: 'all', code: false }))).toBe('a → b')
  })

  test('carries the style of the words around it', () => {
    const style = { ...BODY, weight: 'bold' as const, grey: 9 }
    for (const run of textRuns('x -> y', style, { scope: 'all', code: false })) {
      expect(run.style).toEqual(style)
    }
  })
})
