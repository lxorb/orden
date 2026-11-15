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
  retag,
  selectImageAhead,
  selectImageBehind,
  selectedImage,
  snapPercent,
  sourceCaret,
} from './image'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'
import type { ImageSpec } from './image/markup'

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
  test('reads the path, alt, title and zoom', () => {
    expect(parseHtmlImage('<img src="a.png" alt="x" title="t" style="zoom: 60%" />')).toEqual({
      src: 'a.png',
      alt: 'x',
      title: 't',
      zoom: 60,
    })
  })

  test('defaults to full size and an empty alt', () => {
    expect(parseHtmlImage('<img src="a.png">')).toEqual({
      src: 'a.png',
      alt: '',
      title: '',
      zoom: 100,
    })
  })

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
  test('is plain markdown at full size', () => {
    expect(imageMarkup({ src: 'a.png', alt: 'x', title: '', zoom: 100 })).toBe('![x](a.png)')
  })

  test('keeps a title in the markdown form', () => {
    expect(imageMarkup({ src: 'a.png', alt: 'x', title: 'Cat', zoom: 100 })).toBe(
      '![x](a.png "Cat")',
    )
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

  test('an address with a space is written between brackets', () => {
    expect(imageMarkup({ src: 'a picture.png', alt: 'x', title: '', zoom: 100 })).toBe(
      '![x](<a picture.png>)',
    )
    expect(imageMarkup({ src: 'a.png', alt: 'x', title: '', zoom: 100 })).toBe('![x](a.png)')
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

describe('an HTML block with a picture in it', () => {
  test('is no picture when it holds more than one, or words besides', () => {
    const two = 'x\n\n<div align="center"><img src="a.png" width="300"><img src="b.png"></div>\n\ny'
    expect(imageAt(state(two), 3)).toBeNull()
    expect(imageAt(state('x\n\n<p>See <img src="i.png"> here</p>\n\ny'), 3)).toBeNull()
  })

  test('is its one picture inside a wrapper, and an edit reaches only the img tag', () => {
    const doc = 'x\n\n<p align="center"><img src="a.png" alt="A"></p>\n\ny'
    const image = imageAt(state(doc), 3)
    expect(image?.src).toBe('a.png')
    expect(doc.slice(image?.tag?.from, image?.tag?.to)).toBe('<img src="a.png" alt="A">')
  })

  test('is its one picture when its words hold a > or it has a space beside it', () => {
    expect(imageAt(state('x\n\n<p><img src="a.png" alt="a > b"></p>\n\ny'), 3)?.alt).toBe('a > b')
    expect(imageAt(state('x\n\n<p><img src="a.png">&nbsp;</p>\n\ny'), 3)?.src).toBe('a.png')
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

  test('keeps its size, and stays markdown, when its words change', () => {
    for (const [doc, written] of [
      ['![a cat|300](a.png)', '![a dog|300](a.png)'],
      ['![a cat|300x200](a.png "Cat")', '![a dog|300x200](a.png "Cat")'],
      ['![a cat\\|300](a.png)', '![a dog\\|300](a.png)'],
    ] as const) {
      const image = imageAt(state(doc), 0)!
      expect(imageMarkup({ ...image, alt: 'a dog' })).toBe(written)
    }
  })
})

describe('brackets in alt text', () => {
  test('are written so the picture stays a picture, and read back as typed', () => {
    const insert = imageMarkup({ src: 'a.png', alt: 'a]b[c', title: '', zoom: 100 })
    expect(insert).toBe('![a\\]b\\[c](a.png)')

    expect(imageAt(state(insert), 0)?.alt).toBe('a]b[c')
  })
})

describe('a picture written again after an edit', () => {
  test('keeps the attributes of its tag that the edit does not touch', () => {
    const tag = '<img src="a.png" class="hero" height="200">'
    const image = imageAt(state(tag), 0)!
    expect(retag(tag, { ...image, alt: 'b' })).toBe(
      '<img src="a.png" class="hero" height="200" alt="b">',
    )
    expect(retag('<img src="a.png" width="300" style="float:left">', { ...image, zoom: 50 })).toBe(
      '<img src="a.png" style="zoom:50%; float:left">',
    )
  })

  test('touches only what changed, whether a value is quoted or not', () => {
    const edit = (tag: string, change: Partial<ImageSpec>) => {
      const image = parseHtmlImage(tag)
      if (!image) throw new Error(`no picture in ${tag}`)
      return retag(tag, { ...image, ...change })
    }
    expect(edit('<img src="a.png" width="50%" alt="x">', { alt: 'y' })).toBe(
      '<img src="a.png" width="50%" alt="y">',
    )
    expect(edit('<img src="a.png" alt="x" title=Sunset>', { alt: 'y' })).toBe(
      '<img src="a.png" alt="y" title=Sunset>',
    )
    expect(edit('<img src="a.png" alt=cat>', { width: 300 })).toBe(
      '<img src="a.png" alt=cat width="300">',
    )
    expect(edit('<img src="a.png" title="the width = 300 one" alt="x">', { alt: 'y' })).toBe(
      '<img src="a.png" title="the width = 300 one" alt="y">',
    )
  })

  test('drops the height when the width changes, so the picture keeps its shape', () => {
    const tag = '<img src="a.png" width="300" height="200">'
    const image = parseHtmlImage(tag)!
    expect(retag(tag, { src: image.src, alt: image.alt, title: image.title, zoom: 100 })).toBe(
      '<img src="a.png">',
    )
    expect(retag(tag, { ...image, width: 400 })).toBe('<img src="a.png" width="400">')
    expect(retag(tag, { ...image, alt: 'b' })).toBe(
      '<img src="a.png" width="300" height="200" alt="b">',
    )
  })

  test('keeps an escape written in its words as it was', () => {
    const image = imageAt(state('![my\\_shot|300](a.png)'), 0)!
    expect(imageMarkup({ src: image.src, alt: image.alt, title: image.title, zoom: 100 })).toBe(
      '![my\\_shot](a.png)',
    )
  })

  test('reads src and alt, not the data- attributes that end in those names', () => {
    expect(
      parseHtmlImage('<img data-src="lazy.png" src="a.png" data-alt="no" alt="yes">'),
    ).toMatchObject({ src: 'a.png', alt: 'yes' })
  })

  test('keeps a title with quotes in it, and words ending in a backslash, a picture', () => {
    const quoted = imageAt(state(`![a](x.png 'say "hi"')`), 0)!
    expect(quoted.title).toBe('say "hi"')
    const written = imageMarkup({ ...quoted, alt: 'b' })
    expect(imageAt(state(written), 0)).toMatchObject({ alt: 'b', title: 'say "hi"' })

    const slashed = imageMarkup({ src: 'a.png', alt: 'C:\\', title: '', zoom: 100 })
    expect(imageAt(state(slashed), 0)).toMatchObject({ src: 'a.png', alt: 'C:\\' })
  })
})
