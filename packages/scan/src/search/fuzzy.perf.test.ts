import { describe, expect, test } from 'vitest'
import { Fuzzy, fuzzyTerms, workDone } from './fuzzy'
import { fold, Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

const CLOCKED = process.env.ORDEN_PERF === '1'

function shared(body: string, count: () => void): () => string {
  let made: string | null = null

  return () => {
    if (made === null) {
      count()
      made = fold(body)
    }

    return made
  }
}

function corpus(): { notes: SearchNote[]; folds: () => number } {
  const paragraphs = [
    'The quarter plan came together on Monday, with a note about the budget.',
    'Beta wrote the meeting up and left the actions at the end of it.',
    'A canvas of the release, with the blockers arranged down the left.',
    'Reading the draft again, the second half is the half that works.',
    'Numbers for the month: seventeen open, four closed, one waiting.',
  ]

  const notes: SearchNote[] = []
  let folds = 0

  for (let index = 0; index < 10_000; index++) {
    const lines: string[] = [`# Note ${index}`, '']
    for (let line = 0; line < 70; line++) {
      lines.push(paragraphs[(index + line) % paragraphs.length] ?? '', '')
    }

    const body = lines.join('\n')

    notes.push({
      path: `/space/folder-${index % 50}/note-${index}.md`,
      relative: `folder-${index % 50}/note-${index}.md`,
      name: `note-${index}.md`,
      body,
      folded: shared(body, () => folds++),
    })
  }

  return { notes, folds: () => folds }
}

function withWords(notes: readonly SearchNote[]): number {
  let count = 0

  for (const note of notes) {
    let from = 0
    for (;;) {
      const broke = note.body.indexOf('\n', from)
      const end = broke === -1 ? note.body.length : broke
      if (end > from) count++
      if (broke === -1) break

      from = broke + 1
    }
  }

  return count
}

function once(source: string, notes: readonly SearchNote[]) {
  const query = parseQuery(source)
  const matcher = new Matcher(query)
  const fuzzy = new Fuzzy(fuzzyTerms(query))

  workDone()
  const started = performance.now()
  let found = 0

  for (const note of notes) {
    if (matcher.hits(note, 1).length) continue
    if (fuzzy.best(note)) found++
  }

  return { ms: performance.now() - started, found, work: workDone() }
}

const RUNS = 3

function timed(source: string, notes: readonly SearchNote[]) {
  let best = once(source, notes)
  for (let run = 1; run < RUNS; run++) {
    const one = once(source, notes)
    if (one.ms < best.ms) best = one
  }

  return best
}

describe('a loose search over ten thousand notes', () => {
  const { notes, folds } = corpus()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)
  const lines = withWords(notes)

  const yardstick = timed('quater', notes)

  test('is a space of the size the figures are about', () => {
    expect(notes).toHaveLength(10_000)
    expect(bytes).toBeGreaterThan(45_000_000)
    expect(lines).toBe(710_000)
  })

  test('costs about what an exact one does, for a typo', () => {
    const { ms, found, work } = yardstick

    expect(found).toBe(10_000)
    expect(work.notes).toBe(10_000)
    expect(folds()).toBe(10_000)
    expect(work.lines).toBe(lines)
    expect(work.characters).toBeLessThan(bytes * 2)
    if (CLOCKED) expect(ms).toBeLessThan(2_000)
  })

  test('and for two words, which is two scans of every line', () => {
    const { found, work } = once('quater plna', notes)

    expect(found).toBe(10_000)
    expect(work.lines).toBe(yardstick.work.lines)
    expect(work.terms).toBe(yardstick.work.terms * 2)
    expect(work.characters).toBeLessThan(yardstick.work.characters * 2)
  })

  test('and almost nothing for a word nothing holds, because it gives up', () => {
    const { found, work } = once('zzzqx', notes)

    expect(found).toBe(0)
    expect(work.notes).toBe(10_000)
    expect(work.lines).toBe(0)
    expect(work.terms).toBe(0)
    expect(work.characters).toBe(bytes)
  })
})

function longNotes(): { notes: SearchNote[]; folds: () => number } {
  const lines: string[] = []
  for (let line = 0; line < 12_000; line++) {
    lines.push('The meeting came together on Monday, with a note about the budget for it.')
  }

  const body = lines.join('\n')
  let folds = 0

  return {
    notes: Array.from({ length: 4 }, (_unused, index) => ({
      path: `/space/long-${index}.md`,
      relative: `long-${index}.md`,
      name: `long-${index}.md`,
      body,
      folded: shared(body, () => folds++),
    })),
    folds: () => folds,
  }
}

describe('a loose search over long notes', () => {
  const { notes, folds } = longNotes()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)
  const lines = withWords(notes)

  const yardstick = once('ate', notes)

  test('is a corpus of the size the figures are about', () => {
    expect(notes[0]?.body.length).toBeGreaterThan(800_000)
    expect(lines).toBe(48_000)
    expect(folds()).toBe(4)
    expect(yardstick.work.lines).toBe(lines)
  })

  test('costs no more for a letter the note has not got after one it has', () => {
    const { found, work } = once('aqx', notes)

    expect(found).toBe(0)
    expect(work.lines).toBe(yardstick.work.lines)
    expect(work.terms).toBe(work.lines)
    expect(work.characters).toBeLessThan(yardstick.work.characters)
    expect(work.characters).toBeLessThan(bytes * 2)
  })
})
