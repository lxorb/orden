import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
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
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function state(doc: string, selection: { anchor: number; head?: number } = { anchor: 0 }) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.single(selection.anchor, selection.head ?? selection.anchor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function run(command: StateCommand, from: EditorState): { anchor: number; head: number } | null {
  const states: EditorState[] = []
  const handled = command({
    state: from,
    dispatch: (transaction: Transaction) => states.push(transaction.state),
  })

  const next = states.at(-1)
  if (!handled || !next) return null

  const range = next.selection.main
  return { anchor: range.anchor, head: range.head }
}

const MD = '![A cat](cat.png)'
const TAG = '<img src="cat.png" alt="A cat" style="zoom:50%;" />'

describe('parsing an img tag', () => {
  test.each([
    [
      '<img src="a.png" alt="x" title="t" style="zoom: 60%" />',
      { src: 'a.png', alt: 'x', title: 't', zoom: 60 },
    ],
    ['<img src="a.png">', { src: 'a.png', alt: '', title: '', zoom: 100 }],
  ])('%j', (input, wanted) => expect(parseHtmlImage(input)).toEqual(wanted))

  test('keeps a width attribute as pixels', () => {
    expect(parseHtmlImage('<img src="a.png" width="320">')?.width).toBe(320)
  })

  test('lets a zoom win over a width', () => {
    const spec = parseHtmlImage('<img src="a.png" width="320" style="zoom:50%;">')
    expect(spec).toEqual({ src: 'a.png', alt: '', title: '', zoom: 50 })
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
  test.each([
    [{ src: 'a.png', alt: 'x', title: '', zoom: 100 }, '![x](a.png)'],
    [{ src: 'a.png', alt: 'x', title: 'Cat', zoom: 100 }, '![x](a.png "Cat")'],
    [
      { src: 'a.png', alt: 'x', title: '', zoom: 50 },
      '<img src="a.png" alt="x" style="zoom:50%;" />',
    ],
    [
      { src: 'a.png', alt: 'say "hi" & bye', title: '', zoom: 50 },
      '<img src="a.png" alt="say &quot;hi&quot; &amp; bye" style="zoom:50%;" />',
    ],
    [
      { src: 'a.png', alt: '', title: '', zoom: 100, width: 320 },
      '<img src="a.png" alt="" width="320" />',
    ],
    [
      { src: 'a.png', alt: '', title: '', zoom: 40, width: 320 },
      '<img src="a.png" alt="" style="zoom:40%;" />',
    ],
    [{ src: 'a picture.png', alt: 'x', title: '', zoom: 100 }, '![x](<a picture.png>)'],
  ])('%j', (input, wanted) => expect(imageMarkup(input)).toEqual(wanted))

  test('round-trips through the parser', () => {
    const spec = { src: 'p/a b.png', alt: 'x "y"', title: 'T', zoom: 33 }
    expect(parseHtmlImage(imageMarkup(spec))).toEqual(spec)
  })
})

describe('resizing', () => {
  test.each([
    [48, 50],
    [52.4, 50],
    [31, 33],
    [98, 100],
    [41.6, 42],
  ])('%j', (input, wanted) => expect(snapPercent(input)).toEqual(wanted))

  test('can be asked not to snap', () => {
    expect(snapPercent(48, false)).toBe(48)
  })

  test('turns a drag into a percentage of the natural width', () => {
    expect(resizeTo(200, 40, 400, 1000)).toBe(60)
  })

  test('never exceeds the natural size or the line', () => {
    expect(resizeTo(200, 900, 400, 1000)).toBe(100)
    expect(resizeTo(400, 900, 1000, 500)).toBe(50)
  })

  test('keeps a minimum width', () => {
    expect(resizeTo(200, -900, 400, 1000)).toBe(12)
  })
})

describe('finding images by position', () => {
  test('reads an address written between angle brackets', () => {
    expect(imageAt(state('![x](<a picture.png>)'), 0)?.src).toBe('a picture.png')
    expect(imageAt(state('![x](<a.png>)'), 0)?.src).toBe('a.png')
  })

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

  test.each([
    [state(doc, { anchor: from + 3 }), true, from, to],
    [state(doc, { anchor: from }), false, from, to],
    [state(doc, { anchor: to }), false, from, to],
    [state(doc, { anchor: from, head: to }), false, from, to],
    [state(doc, { anchor: 0, head: doc.length }), false, from, to],
    [state(doc, { anchor: 0, head: from + 4 }), true, from, to],
  ])('%j', (input, wanted, extra, last) =>
    expect(imageRevealed(input, extra, last)).toEqual(wanted),
  )
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

  test.each([
    [selectImageBehind, { anchor: from, head: to }, state(doc, { anchor: to })],
    [selectImageAhead, { anchor: from, head: to }, state(doc, { anchor: from })],
  ])('%j', (input, wanted, extra) => expect(run(input, extra)).toEqual(wanted))

  test('both give way anywhere else', () => {
    expect(run(selectImageBehind, state(doc, { anchor: 1 }))).toBeNull()
    expect(run(selectImageAhead, state(doc, { anchor: to }))).toBeNull()
    expect(run(selectImageBehind, state(doc, { anchor: from, head: to }))).toBeNull()
  })

  test('give way while the markup is showing', () => {
    const revealed = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.create([
          EditorSelection.cursor(to),
          EditorSelection.cursor(from + 3),
        ]),
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        ],
      }),
    )
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

describe('a markdown picture with a size after a bar', () => {
  test('is that wide, and its words are the words before the bar', () => {
    expect(imageAt(state('![a cat|300](a.png)'), 0)).toMatchObject({ alt: 'a cat', width: 300 })
    expect(imageAt(state('![\\|100x200](a.png)'), 0)).toMatchObject({ alt: '', width: 100 })
    expect(imageAt(state('![a|b](a.png)'), 0)).toMatchObject({ alt: 'a|b' })
  })
})

describe('brackets in alt text', () => {
  test('are written so the picture stays a picture, and read back as typed', () => {
    const insert = imageMarkup({ src: 'a.png', alt: 'a]b[c', title: '', zoom: 100 })
    expect(insert).toBe('![a\\]b\\[c](a.png)')

    expect(imageAt(state(insert), 0)?.alt).toBe('a]b[c')
  })
})
