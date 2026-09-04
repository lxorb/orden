import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import {
  editSelectedImage,
  imageAt,
  imageEndingAt,
  imageMarkup,
  imageRevealed,
  leaveSelectedImage,
  parseHtmlImage,
  resizeTo,
  selectImageAhead,
  selectImageBehind,
  selectedImage,
  snapPercent,
  sourceCaret,
} from './image'
import { nibMarkdownExtensions } from '../markdown/extensions'

function state(doc: string, selection: { anchor: number; head?: number } = { anchor: 0 }) {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(selection.anchor, selection.head ?? selection.anchor),
    extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
  })
}

/** Runs a command and returns the selection it left, or null when it declined. */
function run(command: StateCommand, from: EditorState): { anchor: number; head: number } | null {
  let next: EditorState | null = null
  const handled = command({ state: from, dispatch: (tr: Transaction) => (next = tr.state) })
  if (!handled || !next) return null
  const range = (next as EditorState).selection.main
  return { anchor: range.anchor, head: range.head }
}

const MD = '![A cat](cat.png)'
const TAG = '<img src="cat.png" alt="A cat" style="zoom:50%;" />'

describe('parsing an img tag', () => {
  test('reads the path, alt, title and zoom', () => {
    expect(parseHtmlImage('<img src="a.png" alt="x" title="t" style="zoom: 60%" />')).toEqual({
      src: 'a.png',
      alt: 'x',
      title: 't',
      zoom: 60,
    })
  })

  test('defaults to full size and an empty alt', () => {
    expect(parseHtmlImage('<img src="a.png">')).toEqual({ src: 'a.png', alt: '', title: '', zoom: 100 })
  })

  test('keeps a width attribute as pixels', () => {
    expect(parseHtmlImage('<img src="a.png" width="320">')?.width).toBe(320)
  })

  test('unescapes attribute values', () => {
    expect(parseHtmlImage('<img src="a.png" alt="say &quot;hi&quot; &amp; bye">')?.alt).toBe(
      'say "hi" & bye',
    )
  })

  test('accepts single quotes', () => {
    expect(parseHtmlImage("<img src='a.png' alt='x'>")).toMatchObject({ src: 'a.png', alt: 'x' })
  })

  test('ignores tags that are not images', () => {
    expect(parseHtmlImage('<div style="page-break-after: always;"></div>')).toBeNull()
    expect(parseHtmlImage('<video src="a.mp4"></video>')).toBeNull()
  })
})

describe('writing an image back', () => {
  test('is plain markdown at full size', () => {
    expect(imageMarkup({ src: 'a.png', alt: 'x', title: '', zoom: 100 })).toBe('![x](a.png)')
  })

  test('keeps a title in the markdown form', () => {
    expect(imageMarkup({ src: 'a.png', alt: 'x', title: 'Cat', zoom: 100 })).toBe('![x](a.png "Cat")')
  })

  test('is an img tag with a zoom the way Typora writes it', () => {
    expect(imageMarkup({ src: 'a.png', alt: 'x', title: '', zoom: 50 })).toBe(
      '<img src="a.png" alt="x" style="zoom:50%;" />',
    )
  })

  test('escapes quotes and ampersands in attributes', () => {
    expect(imageMarkup({ src: 'a.png', alt: 'say "hi" & bye', title: '', zoom: 50 })).toBe(
      '<img src="a.png" alt="say &quot;hi&quot; &amp; bye" style="zoom:50%;" />',
    )
  })

  test('keeps a width attribute until a zoom replaces it', () => {
    expect(imageMarkup({ src: 'a.png', alt: '', title: '', zoom: 100, width: 320 })).toBe(
      '<img src="a.png" alt="" width="320" />',
    )
    expect(imageMarkup({ src: 'a.png', alt: '', title: '', zoom: 40, width: 320 })).toBe(
      '<img src="a.png" alt="" style="zoom:40%;" />',
    )
  })

  test('round-trips through the parser', () => {
    const spec = { src: 'p/a b.png', alt: 'x "y"', title: 'T', zoom: 33 }
    expect(parseHtmlImage(imageMarkup(spec))).toEqual(spec)
  })
})

describe('resizing', () => {
  test('snaps to the common fractions', () => {
    expect(snapPercent(48)).toBe(50)
    expect(snapPercent(52.4)).toBe(50)
    expect(snapPercent(31)).toBe(33)
    expect(snapPercent(98)).toBe(100)
  })

  test('rounds to whole percent away from a stop', () => {
    expect(snapPercent(41.6)).toBe(42)
  })

  test('can be asked not to snap', () => {
    expect(snapPercent(48, false)).toBe(48)
  })

  test('turns a drag into a percentage of the natural width', () => {
    // 400px natural, drawn at 200px, dragged 40px wider: 240px is 60%.
    expect(resizeTo(200, 40, 400, 1000)).toBe(60)
  })

  test('never exceeds the natural size or the line', () => {
    expect(resizeTo(200, 900, 400, 1000)).toBe(100)
    // A 1000px image in a 500px line cannot grow past the line.
    expect(resizeTo(400, 900, 1000, 500)).toBe(50)
  })

  test('keeps a minimum width', () => {
    expect(resizeTo(200, -900, 400, 1000)).toBe(12)
  })
})

describe('finding images by position', () => {
  test('finds the markdown image that starts at a position', () => {
    expect(imageAt(state(`text ${MD}`), 5)).toEqual({
      src: 'cat.png',
      alt: 'A cat',
      title: '',
      zoom: 100,
      from: 5,
      to: 5 + MD.length,
    })
  })

  test('finds an img tag by its start or end', () => {
    const doc = `a ${TAG} b`
    expect(imageAt(state(doc), 2)?.zoom).toBe(50)
    expect(imageEndingAt(state(doc), 2 + TAG.length)?.src).toBe('cat.png')
  })

  test('finds a tag on its own line', () => {
    const doc = 'x\n\n<img src="cat.png">\n\ny'
    expect(imageAt(state(doc), 3)?.src).toBe('cat.png')
  })

  test('answers null for anything else', () => {
    expect(imageAt(state(`text ${MD}`), 4)).toBeNull()
    expect(imageAt(state('plain'), 0)).toBeNull()
    expect(imageAt(state('<div style="page-break-after: always;"></div>'), 0)).toBeNull()
  })

  test('reads a title from the markdown form', () => {
    expect(imageAt(state('![a](b.png "Title")'), 0)?.title).toBe('Title')
  })
})

describe('what reveals the markup', () => {
  const doc = `x ${MD} y`
  const from = 2
  const to = 2 + MD.length

  test('a caret strictly inside', () => {
    expect(imageRevealed(state(doc, { anchor: from + 3 }), from, to)).toBe(true)
  })

  test('not a caret touching either end', () => {
    expect(imageRevealed(state(doc, { anchor: from }), from, to)).toBe(false)
    expect(imageRevealed(state(doc, { anchor: to }), from, to)).toBe(false)
  })

  test('not a selection covering it exactly, or more than it', () => {
    expect(imageRevealed(state(doc, { anchor: from, head: to }), from, to)).toBe(false)
    expect(imageRevealed(state(doc, { anchor: 0, head: doc.length }), from, to)).toBe(false)
  })

  test('a selection with one end inside', () => {
    expect(imageRevealed(state(doc, { anchor: 0, head: from + 4 }), from, to)).toBe(true)
  })
})

describe('the selected image', () => {
  test('is the one the selection covers exactly', () => {
    expect(selectedImage(state(MD, { anchor: 0, head: MD.length }))?.src).toBe('cat.png')
  })

  test('is nothing for a caret or a wider selection', () => {
    expect(selectedImage(state(MD, { anchor: 0 }))).toBeNull()
    expect(selectedImage(state(`a ${MD}`, { anchor: 0, head: MD.length + 2 }))).toBeNull()
  })
})

describe('keys beside an image', () => {
  const doc = `a ${MD} b`
  const from = 2
  const to = 2 + MD.length

  test('Backspace after a picture selects it instead of deleting into it', () => {
    expect(run(selectImageBehind, state(doc, { anchor: to }))).toEqual({ anchor: from, head: to })
  })

  test('Delete before a picture selects it', () => {
    expect(run(selectImageAhead, state(doc, { anchor: from }))).toEqual({ anchor: from, head: to })
  })

  test('both give way anywhere else', () => {
    expect(run(selectImageBehind, state(doc, { anchor: 1 }))).toBeNull()
    expect(run(selectImageAhead, state(doc, { anchor: to }))).toBeNull()
    expect(run(selectImageBehind, state(doc, { anchor: from, head: to }))).toBeNull()
  })

  test('give way while the markup is showing', () => {
    // A second caret inside the image reveals it; the first sits after it.
    const revealed = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(to), EditorSelection.cursor(from + 3)]),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
      ],
    })
    expect(run(selectImageBehind, revealed)).toBeNull()
  })
})

describe('keys on a selected image', () => {
  const doc = `a ${MD} b`
  const from = 2
  const to = 2 + MD.length
  const selected = state(doc, { anchor: from, head: to })

  test('Enter puts the caret at the end of the alt text, showing the markup', () => {
    const caret = from + 2 + 'A cat'.length
    expect(run(editSelectedImage, selected)).toEqual({ anchor: caret, head: caret })
  })

  test('Escape steps off to just after the picture', () => {
    expect(run(leaveSelectedImage, selected)).toEqual({ anchor: to, head: to })
  })

  test('neither applies without a selected image', () => {
    expect(run(editSelectedImage, state(doc, { anchor: to }))).toBeNull()
    expect(run(leaveSelectedImage, state(doc, { anchor: 0, head: doc.length }))).toBeNull()
  })
})

describe('where the caret goes to edit the markup', () => {
  test('after the alt in the markdown form', () => {
    const doc = `a ${MD}`
    expect(sourceCaret(state(doc), imageAt(state(doc), 2)!)).toBe(2 + 2 + 'A cat'.length)
  })

  test('after the alt attribute in the tag form', () => {
    const doc = `a ${TAG}`
    const tag = imageAt(state(doc), 2)!
    const caret = sourceCaret(state(doc), tag)
    expect(doc.slice(caret - 5, caret + 1)).toBe('A cat"')
  })

  test('just inside a tag with no alt', () => {
    const doc = '<img src="a.png">'
    expect(sourceCaret(state(doc), imageAt(state(doc), 0)!)).toBe(1)
  })
})
