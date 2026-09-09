import { describe, expect, test } from 'vitest'
import { scanHeadings } from './outline'
import { moveSection, movesSection, sectionSpan } from './sections'

const NOTE = ['# One', 'first', '', '## Under one', 'nested', '', '# Two', 'second', ''].join('\n')

/** The note with a move applied, which is what the editor would end up holding. */
function moved(text: string, from: number, to: number): string | null {
  const headings = scanHeadings(text)
  const made = moveSection(text, headings, from, to)
  if (!made) return null

  // Applied back to front, so the earlier offsets are still the note's own.
  let out = text
  for (const change of [...made.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to)
  }

  return out
}

describe('what a section is', () => {
  const headings = scanHeadings(NOTE)

  test('a heading and everything under it, down to the next of its own level', () => {
    const span = sectionSpan(NOTE, headings, 0)
    expect(NOTE.slice(span!.from, span!.to)).toBe('# One\nfirst\n\n## Under one\nnested\n\n')
  })

  test('a deeper heading stops at the next heading of any level at or above it', () => {
    const span = sectionSpan(NOTE, headings, 1)
    expect(NOTE.slice(span!.from, span!.to)).toBe('## Under one\nnested\n\n')
  })

  test('and the last one runs to the end of the note', () => {
    const span = sectionSpan(NOTE, headings, 2)
    expect(NOTE.slice(span!.from, span!.to)).toBe('# Two\nsecond\n')
  })
})

describe('which moves are moves at all', () => {
  const headings = scanHeadings(NOTE)

  test('a section onto another one', () => {
    expect(movesSection(headings, 0, 2)).toBe(true)
    expect(movesSection(headings, 2, 0)).toBe(true)
  })

  test('but never onto itself, or into itself', () => {
    // Dropping "One" onto the heading nested inside it would be putting a
    // section inside itself, which is not a move.
    expect(movesSection(headings, 0, 0)).toBe(false)
    expect(movesSection(headings, 0, 1)).toBe(false)
  })

  test('and a row nobody has is nothing to move', () => {
    expect(movesSection(headings, 0, 9)).toBe(false)
    expect(moveSection(NOTE, headings, 0, 9)).toBe(null)
  })
})

describe('moving one', () => {
  test('down the list puts it after the section it was dropped on', () => {
    expect(moved(NOTE, 0, 2)).toBe('# Two\nsecond\n# One\nfirst\n\n## Under one\nnested\n\n')
  })

  test('up the list puts it in front of the section it was dropped on', () => {
    expect(moved(NOTE, 2, 0)).toBe('# Two\nsecond\n# One\nfirst\n\n## Under one\nnested\n\n')
  })

  test('takes the whole of it, children and all', () => {
    const out = moved(NOTE, 0, 2) ?? ''
    expect(out).toContain('## Under one')
    // Once, not twice.
    expect(out.match(/## Under one/g)).toHaveLength(1)
    // And every word the note had is still in it.
    expect(scanHeadings(out).map((one) => one.text)).toEqual(['Two', 'One', 'Under one'])
  })

  test('a nested section on its own, leaving its parent where it was', () => {
    const out = moved(NOTE, 1, 2) ?? ''
    expect(scanHeadings(out).map((one) => one.text)).toEqual(['One', 'Two', 'Under one'])
  })

  test('and never leaves a section running into the one below it', () => {
    // The last section of a note may have no line break at the end of it; put
    // in front of another one, it would have swallowed that one's heading.
    const note = '# One\nfirst\n\n# Two\nsecond'
    expect(moved(note, 1, 0)).toBe('# Two\nsecond\n# One\nfirst\n\n')
  })

  test('as two edits, so nothing outside them is rewritten', () => {
    const headings = scanHeadings(NOTE)
    const made = moveSection(NOTE, headings, 0, 2)

    expect(made?.changes).toHaveLength(2)
    // One of them takes nothing away, and one of them puts nothing in.
    expect(made?.changes.filter((one) => one.insert === '')).toHaveLength(1)
    expect(made?.changes.filter((one) => one.from === one.to)).toHaveLength(1)
  })
})

describe('the caret', () => {
  test('travels with the section it was in', () => {
    const headings = scanHeadings(NOTE)
    // On the `f` of "first", six characters into the note.
    const made = moveSection(NOTE, headings, 0, 2, 6)
    const out = moved(NOTE, 0, 2) ?? ''

    expect(out.slice(made!.caret, made!.caret + 5)).toBe('first')
  })

  test('and is left to the change set when it was somewhere else', () => {
    const headings = scanHeadings(NOTE)
    const made = moveSection(NOTE, headings, 0, 2, NOTE.length - 1)

    // Unchanged: outside the moving words, so the change set maps it.
    expect(made?.caret).toBe(NOTE.length - 1)
  })
})
