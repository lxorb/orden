import { describe, expect, test } from 'vitest'
import { Fuzzy, fuzzyTerms } from './fuzzy'
import { Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

/** Fast is a feature, so the figure is a test rather than a note in a commit
 *  message. What is measured is the scoring itself, over a space held in memory:
 *  reading the notes is the disk's or the browser's storage's, is the same work
 *  the exact search already did before there was any loose matching, and would
 *  measure the machine rather than this code.
 *
 *  The budget is the browser's, 300 ms, because this is the code the browser
 *  runs; the crate has its own twin and its own tests. It runs in a worker
 *  there, so the figure is time the reader's typing does not wait for - the
 *  budget is how long a guess takes to appear, not how long a keystroke takes. */

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

/** How long the loose pass takes over the whole space, in milliseconds, and how
 *  many notes answered. */
function timed(source: string, notes: readonly SearchNote[]): { ms: number; found: number } {
  const query = parseQuery(source)
  const matcher = new Matcher(query)
  const fuzzy = new Fuzzy(fuzzyTerms(query))

  const started = performance.now()
  let found = 0

  for (const note of notes) {
    // The walk the search does: a note the query answers is never scored
    // loosely, so the loose pass only ever sees the notes without a row.
    if (matcher.hits(note, 1).length) continue
    if (fuzzy.best(note)) found++
  }

  return { ms: performance.now() - started, found }
}

describe('a loose search over ten thousand notes', () => {
  // Built once: it is fifty megabytes, and building it belongs to no one test.
  const notes = corpus()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)

  test('is a space of the size the figure is about', () => {
    expect(notes).toHaveLength(10_000)
    expect(bytes).toBeGreaterThan(45_000_000)
  })

  test('answers a typo inside the budget', () => {
    // Every note answers this one loosely, which is the worst case: the scan
    // reaches the end of every line of the space rather than giving up early.
    const { ms, found } = timed('quater', notes)

    expect(found).toBe(10_000)
    expect(ms).toBeLessThan(300)
  })

  test('and answers two words inside it as well', () => {
    const { ms } = timed('quater plna', notes)
    expect(ms).toBeLessThan(300)
  })

  test('and a word nothing holds costs almost nothing, because it gives up', () => {
    // A letter missing from a note takes the note out on the first pass over it,
    // so a query that finds nothing is the cheapest kind rather than the dearest.
    const { ms, found } = timed('zzzqx', notes)

    expect(found).toBe(0)
    expect(ms).toBeLessThan(300)
  })
})
