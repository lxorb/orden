import { readCanvas } from '@orden/markdown/canvas'
import { pagesOf } from '@orden/markdown/pages'
import { describe, expect, test } from 'vitest'
import {
  adoptBeside,
  asDraft,
  asItself,
  asPageNote,
  paperNamed,
  paperOutside,
  type Turning,
} from './from-pdf'

function disk(start: Record<string, string>, refuse: boolean | 'after' = false) {
  const files = new Map(Object.entries(start))
  const moves: string[] = []

  const how: Turning = {
    root: '/s',
    exists: (path) => Promise.resolve(files.has(path)),
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => Promise.resolve(void files.set(path, text)),
    move: (from, to) => {
      if (refuse === true) return Promise.reject(new Error('held by another program'))
      moves.push(`${from} -> ${to}`)
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      if (refuse === 'after') return Promise.reject(new Error('permission denied'))
      return Promise.resolve()
    },
    discard: (path) => Promise.resolve(void files.delete(path)),
    sizes: (path) =>
      files.get(path)?.startsWith('%PDF')
        ? Promise.resolve([
            { width: 794, height: 1123 },
            { width: 1123, height: 794 },
          ])
        : Promise.reject(new Error('not a PDF')),
  }

  return { files, moves, how }
}

function pages(text: string | undefined): string[] {
  return pagesOf(readCanvas(text ?? '{}')).map((one) => `${one.file ?? ''}#${String(one.page)}`)
}

const BESIDE = JSON.stringify({
  nodes: [
    {
      id: 'a',
      type: 'file',
      file: 'Lecture.pdf',
      subpath: '#page=1',
      x: 0,
      y: 0,
      width: 794,
      height: 1123,
    },
  ],
  edges: [],
  orden: { version: 1, pages: [{ id: 'a', paper: 'a4', pattern: 'blank' }] },
})

describe('a PDF whose move happened and then failed (#537)', () => {
  test('is kept in its note: the note is not discarded, and the paper with it', async () => {
    const { files, how } = disk({ '/s/Lecture.pdf': '%PDF' }, 'after')

    expect(await asPageNote('/s/Lecture.pdf', how)).toBe('/s/Lecture.pages')
    expect(files.get('/s/Lecture.pages.pdf')).toBe('%PDF')
    expect(files.has('/s/Lecture.pages')).toBe(true)
  })
})

describe('a PDF, as the page note that holds it', () => {
  test('is a note of its name, in its folder, and the bytes move under the note', async () => {
    const { files, moves, how } = disk({ '/s/Week/Lecture.pdf': '%PDF' })

    expect(await asPageNote('/s/Week/Lecture.pdf', how)).toBe('/s/Week/Lecture.pages')
    expect(moves).toEqual(['/s/Week/Lecture.pdf -> /s/Week/Lecture.pages.pdf'])
    expect(pages(files.get('/s/Week/Lecture.pages'))).toEqual([
      'Lecture.pages.pdf#1',
      'Lecture.pages.pdf#2',
    ])
    expect([...files.keys()].sort()).toEqual(['/s/Week/Lecture.pages', '/s/Week/Lecture.pages.pdf'])
  })

  test('is the note already holding it, asked for by the paper', async () => {
    const { moves, how } = disk({ '/s/Lecture.pages': BESIDE, '/s/Lecture.pages.pdf': '%PDF' })

    expect(await asPageNote('/s/Lecture.pages.pdf', how)).toBe('/s/Lecture.pages')
    expect(moves).toEqual([])
  })

  test('makes a paper whose note has gone a note again, under the name it has', async () => {
    const { files, moves, how } = disk({ '/s/Lecture.pages.pdf': '%PDF' })

    expect(await asPageNote('/s/Lecture.pages.pdf', how)).toBe('/s/Lecture.pages')
    expect(moves).toEqual([])
    expect(pages(files.get('/s/Lecture.pages'))[0]).toBe('Lecture.pages.pdf#1')
  })

  test('moves into the note an older build made beside it, and writes nothing in it', async () => {
    const { files, moves, how } = disk({ '/s/Lecture.pdf': '%PDF', '/s/Lecture.pages': BESIDE })

    expect(await asPageNote('/s/Lecture.pdf', how)).toBe('/s/Lecture.pages')
    expect(moves).toEqual(['/s/Lecture.pdf -> /s/Lecture.pages.pdf'])
    expect(files.get('/s/Lecture.pages')).toBe(BESIDE)
  })

  test("steps aside from a note of its name that is somebody else's", async () => {
    const blank = JSON.stringify({
      nodes: [{ id: 'a', type: 'group', x: 0, y: 0, width: 794, height: 1123, label: 'Page 1' }],
      edges: [],
      orden: { version: 1, pages: [{ id: 'a', paper: 'a4', pattern: 'blank' }] },
    })
    const { files, how } = disk({
      '/s/Lecture.pdf': '%PDF',
      '/s/Lecture.pages': blank,
      '/s/Lecture 2.pages.pdf': '%PDF an orphan',
    })

    expect(await asPageNote('/s/Lecture.pdf', how)).toBe('/s/Lecture 3.pages')
    expect(files.get('/s/Lecture.pages')).toBe(blank)
    expect(files.get('/s/Lecture 3.pages.pdf')).toBe('%PDF')
  })

  test('leaves a file that is not a PDF where it is', async () => {
    const { files, how } = disk({ '/s/Lecture.pdf': 'words' })

    await expect(asPageNote('/s/Lecture.pdf', how)).rejects.toThrow()
    expect([...files.keys()]).toEqual(['/s/Lecture.pdf'])
  })

  test('takes the note away again when the PDF cannot be moved under it', async () => {
    const { files, how } = disk({ '/s/Lecture.pdf': '%PDF' }, true)

    await expect(asPageNote('/s/Lecture.pdf', how)).rejects.toThrow()
    expect([...files.keys()]).toEqual(['/s/Lecture.pdf'])
  })
})

describe('a page note an older build made beside its PDF, opened', () => {
  test('takes the PDF in', async () => {
    const { files, how } = disk({ '/s/Lecture.pdf': '%PDF', '/s/Lecture.pages': BESIDE })

    expect(await adoptBeside('/s/Lecture.pages', how)).toBe(true)
    expect(files.has('/s/Lecture.pdf')).toBe(false)
    expect(files.get('/s/Lecture.pages')).toBe(BESIDE)
  })

  test('but not one it does not name, nor one when it holds a paper already', async () => {
    const other = BESIDE.replace('Lecture.pdf', 'Other.pdf')
    const first = disk({ '/s/Lecture.pdf': '%PDF', '/s/Lecture.pages': other })
    expect(await adoptBeside('/s/Lecture.pages', first.how)).toBe(false)
    expect(first.moves).toEqual([])

    const second = disk({
      '/s/Lecture.pdf': '%PDF',
      '/s/Lecture.pages': BESIDE,
      '/s/Lecture.pages.pdf': '%PDF held',
    })
    expect(await adoptBeside('/s/Lecture.pages', second.how)).toBe(false)
    expect(second.moves).toEqual([])
  })
})

describe('a PDF from outside every space, as a page note nobody has saved', () => {
  const sizes = () =>
    Promise.resolve([
      { width: 794, height: 1123 },
      { width: 816, height: 1056 },
    ])
  const nowhere = () => false

  test('every page reads the paper where it lies', async () => {
    const text = await asDraft('C:\\Users\\me\\Downloads\\Paper.pdf', sizes)

    expect(pagesOf(readCanvas(text)).map((page) => page.file)).toEqual([
      'C:\\Users\\me\\Downloads\\Paper.pdf',
      'C:\\Users\\me\\Downloads\\Paper.pdf',
    ])
    expect(paperOutside(text, nowhere)).toBe('C:\\Users\\me\\Downloads\\Paper.pdf')
  })

  test('a paper of a space or named from the note is no paper from outside', async () => {
    expect(
      paperOutside(await asDraft('/s/Paper.pdf', sizes), (path) => path.startsWith('/s/')),
    ).toBe(null)
    expect(paperOutside(await asDraft('Paper.pdf', sizes), nowhere)).toBeNull()
    expect(paperOutside('not a plane', nowhere)).toBeNull()
  })

  test('saved, its pages name the paper the note holds', async () => {
    const text = await asDraft('/downloads/Paper.pdf', sizes)
    const plane = readCanvas(text)

    const named = paperNamed(plane, '/downloads/Paper.pdf', 'Paper.pages.pdf')

    expect(pagesOf(named).map((page) => page.file)).toEqual(['Paper.pages.pdf', 'Paper.pages.pdf'])
    expect(paperNamed(named, '/downloads/Paper.pdf', 'Paper.pages.pdf')).toBe(named)
  })
})

describe('a PDF with no pages', () => {
  const none = () => Promise.resolve([])

  test('is not turned into a page note, and stays where it was', async () => {
    const { files, moves, how } = disk({ '/s/Empty.pdf': '%PDF' })

    await expect(asPageNote('/s/Empty.pdf', { ...how, sizes: none })).rejects.toThrow(/no pages/)
    expect(moves).toEqual([])
    expect([...files.keys()]).toEqual(['/s/Empty.pdf'])
  })

  test('opens as no blank page, read where it lies or from outside', async () => {
    await expect(asItself('/s/Empty.pdf', none)).rejects.toThrow(/no pages/)
    await expect(asDraft('/downloads/Empty.pdf', none)).rejects.toThrow(/no pages/)
  })
})
