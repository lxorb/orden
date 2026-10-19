import { describe, expect, test, vi } from 'vitest'

import { readPdfPages } from './pdf-pages'
import { sourceOf, type Source } from './sources'

// pdf.js wants its worker, which a test has no page to start; a paper here is any
// file that starts the way a PDF does.
vi.mock('../pdf/document', () => ({
  pageSizes: (bytes: Uint8Array) =>
    new TextDecoder().decode(bytes.slice(0, 4)) === '%PDF'
      ? Promise.resolve([{ width: 612, height: 792 }])
      : Promise.reject(new Error('not a PDF')),
}))

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

describe('papers', () => {
  test('each becomes its page note, byte for byte', async () => {
    const plan = await readPdfPages([file('Lecture 4.pdf', '%PDF-1.7')])

    expect(plan.files).toEqual([
      { kind: 'file', path: 'Lecture 4.pdf', bytes: expect.any(Uint8Array), pages: true },
    ])
    expect(plan.lost).toEqual([])
  })

  test('a name no file may have on Windows is argued with', async () => {
    const plan = await readPdfPages([file('Q&A: week 1?.pdf', '%PDF'), file('CON.pdf', '%PDF')])

    expect(plan.files.map((one) => one.path)).toEqual(['Q&A week 1.pdf', 'CON-.pdf'])
  })

  test('two papers of one name, out of two folders, are two papers', async () => {
    const plan = await readPdfPages([file('a/Notes.pdf', '%PDF'), file('b/notes.pdf', '%PDF')])

    expect(plan.files.map((one) => one.path)).toEqual(['Notes.pdf', 'notes 2.pdf'])
  })

  test('what a Mac zips up beside a paper is left behind rather than said to be broken', async () => {
    const plan = await readPdfPages([
      file('Paper.pdf', '%PDF'),
      file('__MACOSX/._Paper.pdf', 'resource fork'),
      file('.DS_Store', 'junk'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Paper.pdf'])
    expect(plan.lost).toEqual([])
  })

  test('a file that is not a PDF arrives as the file, and says so', async () => {
    const plan = await readPdfPages([file('Broken.pdf', 'hello')])

    expect(plan.files).toEqual([
      { kind: 'file', path: 'Broken.pdf', bytes: expect.any(Uint8Array) },
    ])
    expect(plan.lost).toHaveLength(1)
  })
})
