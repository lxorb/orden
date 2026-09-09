import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** The mark a row wears, drawn rather than described.
 *
 *  file-mark.test.ts holds the set together - every kind has a drawing, no two are
 *  the same picture. What is left is the one thing only rendering can show: that a
 *  row which chose an icon of its own wears that instead of its kind's, and that a
 *  folder and a canvas get this for nothing, because the component reads the icon
 *  off the path rather than being handed one.
 *
 *  Where the icon is kept is three different stores; that is chosen-icon.ts's to
 *  know and this component's not to, so the reader is stood in for here. */

const chosen: Record<string, string | null> = {}
const tints: Record<string, string | null> = {}

vi.mock('./chosen-icon', () => ({
  chosenIcon: (path: string) => chosen[path] ?? null,
  chosenTint: (path: string) => tints[path] ?? null,
}))

const { iconLibrary } = await import('./icon-library.svelte')
const { loadIcons } = await import('./icons')
const { MARKS } = await import('./file-mark')
type Mark = keyof typeof MARKS
const FileMark = (await import('./FileMark.svelte')).default

/** The stroked set, in place before anything is drawn. In the app it arrives a moment
 *  after the first paint and the rows redraw themselves; there is no moment to wait
 *  for here, and what the fallback looks like is the test below it. */
iconLibrary.set = await loadIcons()

/** The `d` of every stroke an icon is made of, which is what tells two drawings
 *  apart in the markup. */
function strokes(icon: readonly (readonly [string, Record<string, unknown>])[]): string[] {
  return icon.flatMap(([, attrs]) => (typeof attrs.d === 'string' ? [attrs.d] : []))
}

function drawn(mark: Mark, path?: string): string {
  return render(FileMark, { props: path === undefined ? { mark } : { mark, path } }).body
}

const rocket = strokes(iconLibrary.shape('rocket') ?? [])

describe('a row that chose an icon of its own', () => {
  test('a note wears it in place of the page', () => {
    chosen['Plan.md'] = 'rocket'
    const body = drawn('note', 'Plan.md')

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.note)[0])
  })

  /** A folder is the row this could not happen for until folders had icons: the
   *  tree passes the path now, and the same one reader answers for all three. */
  test('a folder wears it in place of the folder', () => {
    chosen.Work = 'rocket'
    const body = drawn('folder', 'Work')

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.folder)[0])
  })

  test('and the same one whether the folder is open or shut', () => {
    chosen.Work = 'rocket'

    expect(drawn('folder', 'Work')).toBe(drawn('folder-open', 'Work'))
  })

  test('a canvas wears it in place of the two cards', () => {
    chosen['Board.canvas'] = 'rocket'
    const body = drawn('canvas', 'Board.canvas')

    for (const stroke of rocket) expect(body).toContain(stroke)
    expect(body).not.toContain(strokes(MARKS.canvas)[0])
  })

  /** Nib writes Lucide's plain name; a vault out of Obsidian's Iconize writes a
   *  prefix per pack. Both reach the same drawing, for a folder and a canvas as
   *  much as for a note. */
  test('however the name was spelled in the file or the map', () => {
    chosen.Work = 'LiRocket'
    chosen['Board.canvas'] = 'Rocket'

    for (const stroke of rocket) {
      expect(drawn('folder', 'Work')).toContain(stroke)
      expect(drawn('canvas', 'Board.canvas')).toContain(stroke)
    }
  })

  /** An emoji is a character rather than a drawing, so it is set in the same box
   *  instead of being stroked - and that is the same for all three kinds. */
  test('or is an emoji, set in the same box instead of stroked', () => {
    chosen.Work = '🚀'
    chosen['Board.canvas'] = '🚀'

    for (const path of ['Work', 'Board.canvas']) {
      const body = drawn(path === 'Work' ? 'folder' : 'canvas', path)
      expect(body).toContain('🚀')
      expect(body).not.toContain('<svg')
    }
  })
})

describe('an icon with a colour on it', () => {
  test('is drawn in that colour rather than in the foreground', () => {
    chosen.Work = 'rocket'
    tints.Work = 'violet'
    const body = drawn('folder', 'Work')

    // The accent's own shade for this scheme; see accents.ts.
    expect(body).toMatch(/style="[^"]*color:/)
    tints.Work = null
  })

  test('and a colour nothing here knows is no colour at all', () => {
    chosen.Work = 'rocket'
    tints.Work = 'chartreuse'
    expect(drawn('folder', 'Work')).not.toMatch(/style="[^"]*color:/)
    tints.Work = null
  })

  /** A picture is already a picture in its own colours, and painting over one would
   *  be painting over somebody's drawing. */
  test('an emoji takes none', () => {
    chosen.Work = '🚀'
    tints.Work = 'violet'
    expect(drawn('folder', 'Work')).not.toMatch(/style="[^"]*color:/)
    tints.Work = null
  })
})

describe('a row that chose nothing', () => {
  test('wears the mark its kind wears', () => {
    for (const mark of ['note', 'canvas', 'folder', 'folder-open'] as const) {
      const body = drawn(mark, `nothing chose ${mark}`)
      for (const stroke of strokes(MARKS[mark])) expect(body, mark).toContain(stroke)
    }
  })

  test('and so does a caller that knows a name but no path', () => {
    const body = drawn('folder')
    for (const stroke of strokes(MARKS.folder)) expect(body).toContain(stroke)
  })

  /** A name from a pack this build has never heard of, or a word somebody typed
   *  into the front matter by hand. The row is never a blank space. */
  test('and so does a row whose icon the set does not hold', () => {
    chosen.Work = 'not-an-icon-anybody-drew'
    const body = drawn('folder', 'Work')

    for (const stroke of strokes(MARKS.folder)) expect(body).toContain(stroke)
  })
})
