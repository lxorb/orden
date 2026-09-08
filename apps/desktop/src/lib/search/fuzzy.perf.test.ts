import { describe, expect, test } from 'vitest'
import { Fuzzy, fuzzyTerms } from './fuzzy'
import { Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

/** What a loose search costs over a space of ten thousand notes.
 *
 *  Measured against a yardstick taken in the same run rather than against a
 *  number of milliseconds. A test measures the code and not the queue in front
 *  of it: the suite runs several files at once on whatever cores are left, and a
 *  walk that was descheduled halfway through says nothing about the walk. The
 *  yardstick is the exact search for a word every note holds - one full pass over
 *  the space, the work the search already did before there was any loose matching
 *  - so what is asserted is what loose matching adds, which is the question.
 *
 *  The absolute figures, on the machine this was written on: 47.6 MB in 10,000
 *  notes, the yardstick pass 85 ms, one loose term 133 ms, two loose terms
 *  165 ms, and a term the space does not hold 17 ms. The browser's budget is
 *  300 ms and it runs this in a worker; the crate has its own twin and its own
 *  tests. */

/** A space of ten thousand notes and about fifty megabytes of words.
 *
 *  Built out of a few paragraphs rather than out of random letters, so the lines
 *  are the length real lines are and the scorer walks over the mixture of hits
 *  and misses it would walk over in a space of notes. */
function corpus(): SearchNote[] {
  const paragraphs = [
    'The quarter plan came together on Monday, with a note about the budget.',
    'Beta wrote the meeting up and left the actions at the end of it.',
    'A canvas of the release, with the blockers arranged down the left.',
    'Reading the draft again, the second half is the half that works.',
    'Numbers for the month: seventeen open, four closed, one waiting.',
  ]

  const notes: SearchNote[] = []

  for (let index = 0; index < 10_000; index++) {
    const lines: string[] = [`# Note ${index}`, '']
    // Enough paragraphs that a note is about five kilobytes, which is a long
    // note rather than a short one.
    for (let line = 0; line < 70; line++) {
      lines.push(paragraphs[(index + line) % paragraphs.length] ?? '', '')
    }

    notes.push({
      path: `/space/folder-${index % 50}/note-${index}.md`,
      relative: `folder-${index % 50}/note-${index}.md`,
      name: `note-${index}.md`,
      body: lines.join('\n'),
    })
  }

  return notes
}

/** One walk of the whole space, timed, and how many notes answered loosely. */
function once(source: string, notes: readonly SearchNote[], loose: boolean) {
  const query = parseQuery(source)
  const matcher = new Matcher(query)
  const fuzzy = new Fuzzy(loose ? fuzzyTerms(query) : [])

  const started = performance.now()
  let found = 0

  for (const note of notes) {
    // The walk the search does: a note the query answers is never scored
    // loosely, so the loose pass only ever sees the notes without a row.
    if (matcher.hits(note, 1).length) continue
    if (loose && fuzzy.best(note)) found++
  }

  return { ms: performance.now() - started, found }
}

/** How many walks to time. */
const RUNS = 3

/** The fastest of a few walks, which is the one least interrupted. */
function timed(source: string, notes: readonly SearchNote[], loose = true) {
  let best = { ms: Number.POSITIVE_INFINITY, found: 0 }
  for (let run = 0; run < RUNS; run++) {
    const one = once(source, notes, loose)
    if (one.ms < best.ms) best = one
  }

  return best
}

describe('a loose search over ten thousand notes', () => {
  // Built once: it is fifty megabytes, and building it belongs to no one test.
  const notes = corpus()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)

  /** One full pass over the space, exactly, which every search already costs. */
  const yardstick = timed('quarter', notes, false).ms

  test('is a space of the size the figures are about', () => {
    expect(notes).toHaveLength(10_000)
    expect(bytes).toBeGreaterThan(45_000_000)
    expect(yardstick).toBeGreaterThan(0)
  })

  test('costs about what an exact one does, for a typo', () => {
    // Every note answers this one loosely, which is the worst case: the scan
    // reaches the end of every line of the space rather than giving up early.
    const { ms, found } = timed('quater', notes)

    expect(found).toBe(10_000)
    expect(ms).toBeLessThan(yardstick * 3)
  })

  test('and for two words, which is two scans of every line', () => {
    expect(timed('quater plna', notes).ms).toBeLessThan(yardstick * 4)
  })

  test('and almost nothing for a word nothing holds, because it gives up', () => {
    // A letter missing from a note takes the note out before a line of it has
    // been scored, so a query that finds nothing is the cheapest kind rather
    // than the dearest.
    const { ms, found } = timed('zzzqx', notes)

    expect(found).toBe(0)
    expect(ms).toBeLessThan(yardstick)
  })
})
