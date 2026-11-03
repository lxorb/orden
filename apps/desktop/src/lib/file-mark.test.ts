import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    // Nothing but an extension is still that extension.
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

  /** A page note wears its own mark and never a canvas's, though the two hold the
   *  same format: what a row says is what a press on it will open. */
  test('a page note is its own mark', () => {
    expect(fileMark('Lecture 4.pages')).toBe('pages')
    expect(fileMark('Lecture 4.PAGES')).toBe('pages')
    expect(fileMark('Lecture 4.pages.canvas')).toBe('canvas')
    expect(fileMark('Lecture 4.canvas.pages')).toBe('pages')
  })
})

/** The drawings themselves. What is worth checking is not which icon was
 *  chosen but that the set is one set: every mark has a drawing, every drawing
 *  is Lucide's own, and no two marks are the same picture. */
describe('the marks a row wears', () => {
  // The terminal is a tab's mark and never a row's, and is here because the two share
  // one drawing each; see file-mark.ts.
  const MARK_NAMES: Mark[] = [
    'note',
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
  ]

  /** And no folder among them: no row in the list is a folder, so there is no
   *  drawing of one to reach for. See folder-notes.ts. */
  test('every kind of row has one, and a folder is not a kind of row', () => {
    for (const name of MARK_NAMES) {
      expect(MARKS[name], name).toBeDefined()
      expect(MARKS[name].length, name).toBeGreaterThan(0)
    }

    expect(Object.keys(MARKS).sort()).toEqual([...MARK_NAMES].sort())
  })

  /** By value rather than by identity, because the marks are imported one file each
   *  rather than off the library's index - a static import from the index puts all six
   *  thousand icons in front of the app's first paint. The two are the same drawing and
   *  need not be the same array; see file-mark.ts.
   *
   *  All but the canvas, which is the library's `workflow` on the family's grid: the
   *  drawing is Lucide's and the size is the set's. What that is and why is below. And
   *  the PDF, which is Lucide's page with its name on it; also below. */
  test('all of them come from the icon library rather than being drawn here', () => {
    const library = Object.values(lucide)
      .filter(Array.isArray)
      .map((one) => JSON.stringify(one))

    for (const name of MARK_NAMES.filter((one) => one !== 'canvas' && one !== 'pdf')) {
      expect(library, name).toContain(JSON.stringify(MARKS[name]))
    }
  })

  /** The canvas, which is the one mark the set had to be told about.
   *
   *  Lucide builds `workflow` out of its own eight unit cards, so its artwork fills
   *  eighteen of the twenty-four where every other mark here fills twenty. In a row
   *  that is a tenth of a pixel; at the size the buttons in an empty pane draw a mark,
   *  and on a pinned tab, which is its mark and nothing else, it reads as the canvas
   *  being smaller than what it sits beside.
   *
   *  So it is the same drawing at the family's size: the same three shapes in the same
   *  order, the cards a quarter rounded as Lucide rounds them, two units of air between
   *  them as Lucide leaves, and the ink from 2 to 22 like the rest of the set. */
  test('the canvas is that drawing on the grid the rest of the set fills', () => {
    const [first, line, second] = MARKS.canvas
    expect(MARKS.canvas.map(([tag]) => tag)).toEqual(lucide.Workflow.map(([tag]) => tag))
    expect(line?.[1].d).toBe('M6.5 11v4.25a2.25 2.25 0 0 0 2.25 2.25H13')

    for (const [card, at] of [
      [first, 2],
      [second, 13],
    ] as const) {
      expect(card?.[1]).toMatchObject({ x: String(at), y: String(at), width: '9', height: '9' })
      // A quarter of the card, which is the corner Lucide drew on a card of eight.
      expect(card?.[1].rx).toBe('2.25')
    }
  })

  /** #676: a PDF says it is one. The page is Lucide's own - the same outline as `file`
   *  down to where the letters start, and the same folded corner - so it sits in a list
   *  beside the note and the plain page as one family, and under it the three letters,
   *  stroked like everything else so they take the list's colour in either theme. */
  test('a PDF is Lucide s page with "PDF" written under it', () => {
    const [outline, corner, ...letters] = MARKS.pdf
    const [page, fold] = lucide.File

    expect(corner).toEqual(fold)
    // The page's own outline as far as the letters, from the bottom left round to the
    // right: the same corners at the same radii.
    expect(outline?.[1].d).toContain('2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8')
    expect(String(page?.[1].d)).toContain(
      '2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8',
    )
    // P, D and F: a stem and a bowl, a stem and a bowl, a stem, an arm and a bar.
    expect(letters).toHaveLength(4)
    for (const [tag] of letters) expect(tag).toBe('path')
  })

  /** On the grid the rest of the set fills and inside it: nothing past 2 or 22, and the
   *  letters on the lower row from 14 to 21, where the page has stopped. */
  test('and its letters sit under the page, inside the box', () => {
    const numbers = (d: unknown) => (String(d).match(/-?\d*\.?\d+/g) ?? []).map(Number)
    const [outline, , ...letters] = MARKS.pdf

    // Every letter starts on the row: P at 3, D at 10, F's arm from 21, each at 14 or 21.
    expect(letters.map(([, attrs]) => String(attrs.d).split(/[a-z]/i)[1])).toEqual([
      '3 21',
      '10 14',
      '21 14',
      '17 17.5',
    ])
    // And the page stops above them.
    expect(Math.max(...numbers(outline?.[1].d).filter((one) => one > 0))).toBeLessThanOrEqual(20)
    expect(String(outline?.[1].d)).toMatch(/^M4 11V/)
  })

  test('no two rows wear the same picture', () => {
    const drawn = MARK_NAMES.map((name) => JSON.stringify(MARKS[name]))
    expect(new Set(drawn).size).toBe(MARK_NAMES.length)
  })

  /** The marks are drawn by naming each element the library asks for, so an
   *  icon made of something FileMark cannot name would come out as an empty
   *  box - visible only as a missing mark in the tree. */
  test('and each is made of shapes a stroke can be drawn on', () => {
    const drawable = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']

    for (const name of MARK_NAMES) {
      for (const [tag] of MARKS[name]) {
        expect(drawable, `${name}: ${tag}`).toContain(tag)
      }
    }
  })
})

/** A note, a canvas or a folder that chose an icon of its own wears it in the same
 *  box, and one place draws it: every list that shows a file draws this component,
 *  so the tree, the tab strip, a search result, a bookmark and the Move sheet all
 *  show the chosen icon without any of them knowing where icons are kept. Read out
 *  of the component, in the way menus.test.ts reads the menus and
 *  touch-scale.test.ts the sizes. */
describe('the mark a file or folder chose for itself', () => {
  const source = readFileSync(fileURLToPath(new URL('./FileMark.svelte', import.meta.url)), 'utf8')

  test('comes from the path the row already knows, through the one reader of all three', () => {
    expect(source).toContain('chosenIcon(path)')
  })

  test('and the kind s own mark is what a row falls back to', () => {
    // Which covers all four of: a row that chose nothing, a caller that knows no
    // path, a name no set holds, and the moment before a set has arrived. `shown` is
    // the kind's mark, or a PDF's for a page note made from one (#676).
    expect(source).toContain('fallback={MARKS[shown]}')
  })

  /** What a file was made from is decided in one place, so no list can draw a page
   *  note made from a PDF as a blank one (#676). */
  test('and what it was made from is asked of the one place that decides it', () => {
    expect(source).toContain('sourceMark(mark, path)')
    expect(source).not.toContain('holdsPaper')
  })

  /** Which KIND a row is comes off its name: a website is `Svelte docs.url`, a
   *  shortcut file, so the globe is drawn from the name like every other kind's and
   *  no list has to ask the index what the file is - the lookup the old `url:` note
   *  needed does not come back. The site's own favicon, which a website does wear
   *  over the globe, is read through the same chosen-icon façade every mark uses, so
   *  this component still names no store of its own. */
  test('the store is reached through the façade, never named here', () => {
    expect(source).not.toContain('links.')
    expect(source).toContain("from './chosen-icon'")
    expect(source).toContain('faviconFor(path, url)')
  })

  /** One box, whichever of the three kinds is in it, and one size in it: `--icon-md`
   *  is 16px under a pointer and `--touch-mark` under a thumb, which the tokens
   *  restate. The font size is there as well as the box because an emoji is type and
   *  a glyph has no width of its own to be stretched; see Icon.svelte. */
  test('every kind of icon is drawn in one box, at one size', () => {
    const style = source.slice(source.indexOf('<style>'))

    expect(style).toContain('width: var(--icon-md)')
    expect(style).toContain('height: var(--icon-md)')
    expect(style).toContain('font-size: var(--icon-md)')
  })
})
