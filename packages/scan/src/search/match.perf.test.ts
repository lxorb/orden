import { describe, expect, test } from 'vitest'
import { fold, Matcher, type SearchNote, workDone } from './match'
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
  const lines: string[] = []
  for (let line = 0; line < 2_000; line++) {
    lines.push(
      `The quarter plan came together on Monday, with a note about the budget for line ${line}.`,
    )
  }

  const body = lines.join('\n')
  let folds = 0

  return {
    notes: Array.from({ length: 20 }, (_unused, index) => ({
      path: `/space/note-${index}.md`,
      relative: `note-${index}.md`,
      name: `note-${index}.md`,
      body,
      folded: shared(body, () => folds++),
    })),
    folds: () => folds,
  }
}

function lineCount(notes: readonly SearchNote[]): number {
  let count = 0

  for (const note of notes) {
    count += 1
    for (let at = note.body.indexOf('\n'); at !== -1; at = note.body.indexOf('\n', at + 1)) {
      count += 1
    }
  }

  return count
}

function once(source: string, notes: readonly SearchNote[]) {
  const matcher = new Matcher(parseQuery(source))

  workDone()
  const started = performance.now()
  let found = 0
  for (const note of notes) found += matcher.hits(note, 1).length

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

describe('a scoped search over long notes', () => {
  const { notes, folds } = corpus()
  const bytes = notes.reduce((sum, note) => sum + note.body.length, 0)
  const lines = lineCount(notes)

  const yardstick = once('zqx', notes)

  test('is a corpus of the size the figures are about', () => {
    expect(notes[0]?.body.length).toBeGreaterThan(150_000)
    expect(lines).toBe(40_000)
    expect(folds()).toBe(20)
    expect(yardstick.work.regions).toBe(0)
    expect(yardstick.work.needles).toBe(notes.length)
    expect(yardstick.work.characters).toBe(bytes)
  })

  test('costs one pass for a word nothing holds, not one per line', () => {
    const { found, work } = once('line:(zqx)', notes)

    expect(found).toBe(0)
    expect(work.regions).toBe(lines)
    expect(work.needles).toBe(yardstick.work.needles)
    expect(work.characters).toBe(yardstick.work.characters)
  })

  test('and one pass for a word every line holds', () => {
    const { ms, found, work } = timed('line:(quarter budget)', notes)

    expect(found).toBe(20)
    expect(work.regions).toBe(lines)
    expect(work.needles).toBe(notes.length * 2)
    expect(work.characters).toBe(bytes * 2)
    if (CLOCKED) expect(ms).toBeLessThan(1_000)
  })

  test('and for a paragraph, which is the same walk over fewer regions', () => {
    const { work } = once('block:(zqx)', notes)

    expect(work.regions).toBe(notes.length)
    expect(work.regions).toBeLessThan(lines)
    expect(work.needles).toBe(yardstick.work.needles)
    expect(work.characters).toBe(yardstick.work.characters)
  })
})
