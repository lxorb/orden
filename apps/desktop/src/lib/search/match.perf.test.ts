import { describe, expect, test } from 'vitest'
import { Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

/** What `line:` `block:` and `section:` cost over long notes.
 *
 *  Measured against a yardstick taken in the same run rather than against a
 *  number of milliseconds, for the reason fuzzy.perf.test.ts gives: the suite
 *  runs several files at once and a walk that was descheduled halfway through
 *  says nothing about the walk. The yardstick is the same term looked for over
 *  the whole note, which is one pass over the words - so what is asserted is
 *  what asking per line adds, which is the question.
 *
 *  A scoped query runs the same walk once per line, and a walk that looks past
 *  the line it was given is a walk over the rest of the note. The notes here are
 *  long on purpose: that is the shape where the difference between one pass and
 *  one pass per line is the difference between a search and a hang. */

/** Twenty long notes: two thousand lines of about a hundred characters each, so
 *  a note is a couple of hundred kilobytes - a book chapter, or a year of a
 *  journal in one file. */
function corpus(): SearchNote[] {
  const lines: string[] = []
  for (let line = 0; line < 2_000; line++) {
    lines.push(
      `The quarter plan came together on Monday, with a note about the budget for line ${line}.`,
    )
  }

  const body = lines.join('\n')

  return Array.from({ length: 20 }, (_unused, index) => ({
    path: `/space/note-${index}.md`,
    relative: `note-${index}.md`,
    name: `note-${index}.md`,
    body,
  }))
}

/** One walk of the whole corpus, timed. */
function once(source: string, notes: readonly SearchNote[]) {
  const matcher = new Matcher(parseQuery(source))

  const started = performance.now()
  let found = 0
  for (const note of notes) found += matcher.hits(note, 1).length

  return { ms: performance.now() - started, found }
}

/** The fastest of a few walks, which is the one least interrupted. */
function timed(source: string, notes: readonly SearchNote[]) {
  let best = { ms: Number.POSITIVE_INFINITY, found: 0 }
  for (let run = 0; run < 3; run++) {
    const one = once(source, notes)
    if (one.ms < best.ms) best = one
  }

  return best
}

describe('a scoped search over long notes', () => {
  // Built once: it belongs to no one test.
  const notes = corpus()

  /** One pass over the words for a term nothing holds, which is the cheapest a
   *  search gets and the floor everything below is measured against. */
  const yardstick = timed('zqx', notes).ms

  test('is a corpus of the size the figures are about', () => {
    expect(notes[0]?.body.length).toBeGreaterThan(150_000)
    expect(yardstick).toBeGreaterThan(0)
  })

  test('costs one pass for a word nothing holds, not one per line', () => {
    const { ms, found } = timed('line:(zqx)', notes)

    expect(found).toBe(0)
    expect(ms).toBeLessThan(yardstick * 20)
  })

  test('and one pass for a word every line holds', () => {
    const { ms, found } = timed('line:(quarter budget)', notes)

    expect(found).toBe(20)
    expect(ms).toBeLessThan(yardstick * 40)
  })

  test('and for a paragraph, which is the same walk over fewer regions', () => {
    expect(timed('block:(zqx)', notes).ms).toBeLessThan(yardstick * 20)
  })
})
