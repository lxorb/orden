import { describe, expect, test, vi } from 'vitest'

const line = vi.hoisted(() => ({
  alone: false,
  said: [] as { kind: string; path: unknown }[],
  hearing: new Map<string, (said: { kind: string; path?: unknown }) => void>(),
}))

vi.mock('../platform/src/windows', () => ({
  windows: {
    get alone() {
      return line.alone
    },
    say: (kind: string, what: { path?: unknown }) => line.said.push({ kind, path: what.path }),
    hear: (kind: string, listener: (said: { kind: string; path?: unknown }) => void) => {
      line.hearing.set(kind, listener)
      return () => line.hearing.delete(kind)
    },
  },
}))

const { marksFromOutside, marksWritten, sheetArrived } = await import('./sheets.svelte')

describe('the highlights beside a PDF, written somewhere else', () => {
  test('an agent here writing them tells the pages here and the other windows', () => {
    const before = marksFromOutside('/space/Paper.pdf')
    marksWritten('/space/Paper.pdf')

    expect(marksFromOutside('/space/Paper.pdf')).toBe(before + 1)
    expect(line.said.at(-1)).toEqual({ kind: 'marks-written', path: '/space/Paper.pdf' })
  })

  test('another window writing them tells the pages in this one', () => {
    const before = marksFromOutside('/space/Other.pdf')
    line.hearing.get('marks-written')?.({ kind: 'marks-written', path: '/space/Other.pdf' })

    expect(marksFromOutside('/space/Other.pdf')).toBe(before + 1)
  })

  test('a sync bringing the sheet in tells the pages of its PDF, and nothing else does', () => {
    const before = marksFromOutside('/space/Lecture.pages.pdf')
    sheetArrived('/space/Lecture.pages.pdf.highlights.json')
    sheetArrived('/space/Lecture.pages.pdf')
    sheetArrived('/space/Notes.md')

    expect(marksFromOutside('/space/Lecture.pages.pdf')).toBe(before + 1)
    expect(line.said.at(-1)).toEqual({ kind: 'marks-written', path: '/space/Lecture.pages.pdf' })
  })

  test('is the same PDF however its path is spelled', () => {
    const before = marksFromOutside('/space/Deep/Paper.pdf')
    sheetArrived('/space//Deep/Paper.pdf.highlights.json')

    expect(marksFromOutside('/space/Deep/Paper.pdf')).toBe(before + 1)
  })

  test('a window alone says nothing to nobody', () => {
    line.alone = true
    const said = line.said.length
    marksWritten('/space/Alone.pdf')
    line.alone = false

    expect(line.said.length).toBe(said)
    expect(marksFromOutside('/space/Alone.pdf')).toBe(1)
  })
})
