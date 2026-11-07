import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import * as lucide from 'lucide'
import { fileMark, type FileMark as Mark, MARKS } from './file-mark'

describe('the mark a file wears', () => {
  test('a note is a note by its extension, whichever one is written', () => {
    expect(fileMark('Read me.md')).toBe('note')
    expect(fileMark('Plan.markdown')).toBe('note')
    expect(fileMark('Notes.mdown')).toBe('note')
    expect(fileMark('Old.mkd')).toBe('note')
  })

  test('a canvas, a paper and a picture each have their own', () => {
    expect(fileMark('Board.canvas')).toBe('canvas')
    expect(fileMark('Deep Learning.pdf')).toBe('pdf')
    expect(fileMark('Bugs.base')).toBe('base')
    expect(fileMark('shot.png')).toBe('picture')
    expect(fileMark('Build.term')).toBe('terminal')
    expect(fileMark('GIMP.application')).toBe('application')
  })

  test('every extension a picture is written in', () => {
    for (const name of [
      'a.png',
      'a.apng',
      'a.jpg',
      'a.jpeg',
      'a.gif',
      'a.webp',
      'a.avif',
      'a.bmp',
      'a.ico',
      'a.svg',
    ]) {
      expect(fileMark(name), name).toBe('picture')
    }
  })

  test('and anything else is a plain file', () => {
    expect(fileMark('notes.txt')).toBe('file')
    expect(fileMark('data.json')).toBe('file')
    expect(fileMark('archive.zip')).toBe('file')
  })

  test('a name with no extension is a file rather than a note', () => {
    expect(fileMark('Makefile')).toBe('file')
    expect(fileMark('')).toBe('file')
  })

  test('a dotfile is read by what follows its last dot', () => {
    expect(fileMark('.gitignore')).toBe('file')
    expect(fileMark('.keep')).toBe('file')
    expect(fileMark('.md')).toBe('note')
  })

  test('the case of the extension makes no difference', () => {
    expect(fileMark('SHOUTING.MD')).toBe('note')
    expect(fileMark('Paper.PDF')).toBe('pdf')
    expect(fileMark('Board.CANVAS')).toBe('canvas')
    expect(fileMark('Shot.PNG')).toBe('picture')
  })

  test('only the last dot decides', () => {
    expect(fileMark('Notes v1.2.md')).toBe('note')
    expect(fileMark('backup.md.bak')).toBe('file')
    expect(fileMark('paper.pdf.md')).toBe('note')
    expect(fileMark('shot.png.canvas')).toBe('canvas')
  })

  test('a name that is only an extension-looking word is a file', () => {
    expect(fileMark('md')).toBe('file')
    expect(fileMark('pdf')).toBe('file')
    expect(fileMark('canvas')).toBe('file')
    expect(fileMark('pages')).toBe('file')
  })

  test('a page note is its own mark', () => {
    expect(fileMark('Lecture 4.pages')).toBe('pages')
    expect(fileMark('Lecture 4.PAGES')).toBe('pages')
    expect(fileMark('Lecture 4.pages.canvas')).toBe('canvas')
    expect(fileMark('Lecture 4.canvas.pages')).toBe('pages')
  })
})

describe('the marks a row wears', () => {
  const MARK_NAMES: Mark[] = [
    'note',
    'folder',
    'canvas',
    'pages',
    'pdf',
    'picture',
    'file',
    'web',
    'terminal',
    'remote',
    'base',
    'chat',
    'application',
    'key',
    'time',
  ]

  test('every kind of row has one, and a folder is not a kind of row', () => {
    for (const name of ['Box', 'Box/', 'Box/Box.md', 'Box.md', 'index.md']) {
      expect(fileMark(name), name).not.toBe('folder')
    }

    for (const name of MARK_NAMES) {
      expect(MARKS[name], name).toBeDefined()
      expect(MARKS[name].length, name).toBeGreaterThan(0)
    }

    expect(Object.keys(MARKS).sort()).toEqual([...MARK_NAMES].sort())
  })

  test('all of them come from the icon library rather than being drawn here', () => {
    const library = Object.values(lucide)
      .filter(Array.isArray)
      .map((one) => JSON.stringify(one))

    const resized = ['canvas', 'application', 'pdf', 'key']
    for (const name of MARK_NAMES.filter((one) => !resized.includes(one))) {
      expect(library, name).toContain(JSON.stringify(MARKS[name]))
    }
  })

  test("Pass's key reaches from the grid's top line to its bottom one, as the rest do", () => {
    const [ring, shaft] = MARKS.key
    expect(ring).toEqual(['circle', { cx: '8', cy: '16', r: '6' }])
    expect(shaft).toEqual(['path', { d: 'm12.25 11.75 9.75-9.75' }])
  })

  test('the canvas is that drawing on the grid the rest of the set fills', () => {
    const [first, line, second] = MARKS.canvas
    expect(MARKS.canvas.map(([tag]) => tag)).toEqual(lucide.Workflow.map(([tag]) => tag))
    expect(line?.[1].d).toBe('M6.5 11v4.25a2.25 2.25 0 0 0 2.25 2.25H13')

    for (const [card, at] of [
      [first, 2],
      [second, 13],
    ] as const) {
      expect(card?.[1]).toMatchObject({ x: String(at), y: String(at), width: '9', height: '9' })
      expect(card?.[1].rx).toBe('2.25')
    }
  })

  test("the application's window is Lucide's panel-top on the grid the rest of the set fills", () => {
    const [frame, bar] = MARKS.application
    expect(MARKS.application.map(([tag]) => tag)).toEqual(['rect', 'path'])
    expect(frame?.[1]).toMatchObject({ x: '3', y: '2', width: '18', height: '20', rx: '2' })
    expect(bar?.[1].d).toBe('M3 9h18')
  })

  test('a PDF is Lucide s page with "PDF" written under it', () => {
    const [outline, corner, ...letters] = MARKS.pdf
    const [page, fold] = lucide.File

    expect(corner).toEqual(fold)
    expect(outline?.[1].d).toContain('2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8')
    expect(String(page?.[1].d)).toContain(
      '2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8',
    )
    expect(letters).toHaveLength(4)
    for (const [tag] of letters) expect(tag).toBe('path')
  })

  test('and its letters sit under the page, inside the box', () => {
    const numbers = (d: unknown) => (String(d).match(/-?\d*\.?\d+/g) ?? []).map(Number)
    const [outline, , ...letters] = MARKS.pdf

    expect(letters.map(([, attrs]) => String(attrs.d).split(/[a-z]/i)[1])).toEqual([
      '3 21',
      '10 14',
      '21 14',
      '17 17.5',
    ])
    expect(Math.max(...numbers(outline?.[1].d).filter((one) => one > 0))).toBeLessThanOrEqual(20)
    expect(String(outline?.[1].d)).toMatch(/^M4 11V/)
  })

  test('no two rows wear the same picture', () => {
    const drawn = MARK_NAMES.map((name) => JSON.stringify(MARKS[name]))
    expect(new Set(drawn).size).toBe(MARK_NAMES.length)
  })

  test('and each is made of shapes a stroke can be drawn on', () => {
    const drawable = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']

    for (const name of MARK_NAMES) {
      for (const [tag] of MARKS[name]) {
        expect(drawable, `${name}: ${tag}`).toContain(tag)
      }
    }
  })
})

describe('the mark a file or folder chose for itself', () => {
  const source = readFileSync(join(import.meta.dirname, './FileMark.svelte'), 'utf8')

  test('comes from the path the row already knows, through the one reader of all three', () => {
    expect(source).toContain('chosenIcon(path)')
  })

  test('and the kind s own mark is what a row falls back to', () => {
    expect(source).toContain('fallback={MARKS[shown]}')
  })

  test('and what it was made from is asked of the one place that decides it', () => {
    expect(source).toContain('sourceMark(mark, path, url)')
    expect(source).not.toContain('holdsPaper')
  })

  test('the store is reached through the façade, never named here', () => {
    expect(source).not.toContain('links.')
    expect(source).toContain("from './chosen-icon'")
    expect(source).toContain('faviconFor(path, url)')
  })

  test('every kind of icon is drawn in one box, at one size', () => {
    const style = source.slice(source.indexOf('<style>'))

    expect(style).toContain('width: var(--icon-md)')
    expect(style).toContain('height: var(--icon-md)')
    expect(style).toContain('font-size: var(--icon-md)')
  })
})
