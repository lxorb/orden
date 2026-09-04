import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { buildDecorations } from './decorate'
import { buildBlockDecorations } from './blocks'
import { nibMarkdownExtensions } from '../markdown/extensions'

/** Somewhere to park the caret that is outside every construct under test. */
const PARK = '\n\nx'

function state(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
    ],
  })
}

/** Text the reader never sees. Without a cursor, the caret parks off the sample. */
function concealed(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const pos = cursor ?? full.length
  const { atomic } = buildDecorations(state(full, pos))

  const out: string[] = []
  atomic.between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

/** Whole-line constructs replaced by a rendered block: math and diagrams. */
function blocks(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const pos = cursor ?? full.length

  const out: string[] = []
  buildBlockDecorations(state(full, pos)).between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

/** Syntax shown as characters, tagged for the ink-bleed animation. */
function revealedMeta(doc: string, cursor: number): string[] {
  const { decorations } = buildDecorations(state(doc, cursor))
  const out: string[] = []
  decorations.between(0, doc.length, (from, to, value) => {
    if (value.spec.class === 'md-meta') out.push(doc.slice(from, to))
  })
  return out
}

/** Ranges carrying a given decoration class. */
function marked(doc: string, className: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  const pos = cursor ?? full.length

  const out: string[] = []
  buildDecorations(state(full, pos)).decorations.between(0, full.length, (from, to, value) => {
    if (value.spec.class === className) out.push(full.slice(from, to))
  })
  return out
}

/** Every class given to a whole line, in document order. */
function lineClasses(doc: string): string[] {
  const full = doc + PARK
  const out: string[] = []
  buildDecorations(state(full, full.length)).decorations.between(0, full.length, (from, to, value) => {
    // Line decorations are the only empty ranges that carry no widget.
    if (from === to && !value.spec.widget && value.spec.class) out.push(...value.spec.class.split(' '))
  })
  return out
}

describe('headings', () => {
  test('hides the hash and its trailing space when the caret is elsewhere', () => {
    expect(concealed('# Title')).toEqual(['# '])
  })

  test('reveals the hash when the caret is on the heading line', () => {
    expect(concealed('# Title\n\nbody', 3)).toEqual([])
    expect(revealedMeta('# Title\n\nbody', 3)).toEqual(['# '])
  })

  test('covers all six levels', () => {
    expect(concealed('###### Six')).toEqual(['###### '])
  })
})

describe('inline emphasis', () => {
  test('hides both markers of an inactive bold span', () => {
    expect(concealed('a **bold** b')).toEqual(['**', '**'])
  })

  test('reveals only the span the caret sits in', () => {
    const doc = '**one** and **two**'
    expect(revealedMeta(doc, 3)).toEqual(['**', '**'])
    expect(concealed(doc, 3)).toEqual(['**', '**'])
  })

  test('handles italic, strikethrough, subscript and superscript', () => {
    expect(concealed('_i_ ~~s~~ H~2~O X^2^')).toEqual([
      '_',
      '_',
      '~~',
      '~~',
      '~',
      '~',
      '^',
      '^',
    ])
  })
})

describe('links', () => {
  test('leaves only the label visible', () => {
    expect(concealed('see [docs](https://x.dev "t") now')).toEqual([
      '[',
      ']',
      '(',
      'https://x.dev',
      '"t"',
      ')',
    ])
  })
})

describe('code', () => {
  test('hides inline backticks', () => {
    expect(concealed('run `npm i` first')).toEqual(['`', '`'])
  })

  test('hides fence markers and the language tag', () => {
    expect(concealed('```js\nlet x\n```')).toEqual(['```', 'js', '```'])
  })

  // Both delimiters come back together, so the block's extent stays obvious
  // wherever in it the caret happens to be.
  test('reveals both fence markers when the caret is on the opening line', () => {
    expect(revealedMeta('```js\nlet x\n```\n', 2)).toEqual(['```', 'js', '```'])
  })

  test('reveals both fence markers from inside the code', () => {
    expect(concealed('```js\nlet x\n```\n', 8)).toEqual([])
  })

  test('reveals both fence markers from the closing line', () => {
    expect(concealed('```js\nlet x\n```\n', 14)).toEqual([])
  })

  test('hides them again once the caret leaves the block', () => {
    expect(concealed('```js\nlet x\n```')).toEqual(['```', 'js', '```'])
  })

  test('leaves a neighbouring fence hidden', () => {
    const doc = '```js\na\n```\n\n```py\nb\n```\n'
    expect(concealed(doc, 8)).toEqual(['```', 'py', '```'])
  })
})

describe('blocks', () => {
  test('hides the quote marker', () => {
    expect(concealed('> quoted')).toEqual(['> '])
  })

  test('replaces a horizontal rule', () => {
    expect(concealed('a\n\n---')).toEqual(['---'])
  })

  test('replaces a bullet marker', () => {
    expect(concealed('- one\n- two')).toEqual(['-', '-'])
  })

  test('replaces the task marker and the bullet before it', () => {
    expect(concealed('- [x] done')).toEqual(['- ', '[x]'])
  })

  test('replaces the whole table with a rendered one', () => {
    expect(blocks('| a |\n| - |\n| 1 |')).toEqual(['| a |\n| - |\n| 1 |'])
    expect(concealed('| a |\n| - |\n| 1 |')).toEqual([])
  })

  test('falls back to source while the caret is in the table', () => {
    expect(blocks('| a |\n| - |\n| 1 |', 8)).toEqual([])
  })
})

describe('images', () => {
  test('replaces the whole image with a rendered widget', () => {
    expect(concealed('![alt](pic.png)')).toEqual(['![alt](pic.png)'])
  })

  test('shows the source once the caret enters it', () => {
    expect(concealed('![alt](pic.png)', 3)).toEqual([])
    expect(revealedMeta('![alt](pic.png)', 3)).toEqual(['![', ']', '(', 'pic.png', ')'])
  })

  test('stays a picture with the caret beside it', () => {
    expect(concealed('![alt](pic.png)', 0)).toEqual(['![alt](pic.png)'])
    expect(concealed('![alt](pic.png)', 15)).toEqual(['![alt](pic.png)'])
  })

  test('stays a picture while it is selected', () => {
    const doc = '![alt](pic.png)'
    const selected = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    })

    const out: string[] = []
    buildDecorations(selected).atomic.between(0, doc.length, (from, to) => {
      out.push(doc.slice(from, to))
    })
    expect(out).toEqual([doc])
  })

  test('renders a resized image written as an img tag', () => {
    const tag = '<img src="pic.png" alt="a" style="zoom:60%" />'
    expect(concealed(`text ${tag} more`)).toEqual([tag])
  })

  test('leaves other inline HTML alone', () => {
    expect(concealed('text <u>underlined</u> more')).toEqual([])
  })

  test('renders a page break', () => {
    const tag = '<div style="page-break-after: always;"></div>'
    expect(concealed(`a\n\n${tag}\n\nb`)).toEqual([tag])
  })

  test('treats a flow fence as a diagram', () => {
    expect(blocks('```flow\nst=>start: Go\n```')).toEqual(['```flow\nst=>start: Go\n```'])
  })
})

describe('extensions', () => {
  test('replaces inline math with a rendered widget', () => {
    expect(concealed('mass $E=mc^2$ here')).toEqual(['$E=mc^2$'])
  })

  test('reveals math source when the caret enters it', () => {
    expect(revealedMeta('mass $E=mc^2$ here', 8)).toEqual(['$', '$'])
  })

  test('replaces a block math fence', () => {
    expect(blocks('$$\nE = mc^2\n$$')).toEqual(['$$\nE = mc^2\n$$'])
  })

  test('replaces a known emoji shortcode', () => {
    expect(concealed('ship it :rocket: now')).toEqual([':rocket:'])
  })

  test('leaves an unknown shortcode alone', () => {
    expect(concealed('a :not_an_emoji_name: b')).toEqual([])
  })

  test('shows the shortcode when the caret is on it', () => {
    expect(concealed('ship :rocket: now', 8)).toEqual([])
  })

  test('hides highlight markers', () => {
    expect(concealed('a ==marked== b')).toEqual(['==', '=='])
  })

  test('hides footnote reference brackets', () => {
    expect(concealed('text[^1] more')).toEqual(['[^', ']'])
  })

  test('hides front matter fences', () => {
    expect(concealed('---\ntitle: Hi\n---\n\nbody')).toEqual(['---', '---'])
  })

  test('replaces a callout tag with its label', () => {
    expect(concealed('> [!NOTE]\n> careful')).toEqual(['> ', '[!NOTE]', '> '])
  })

  test('replaces a mermaid fence with a diagram', () => {
    expect(blocks('```mermaid\ngraph TD;\nA-->B;\n```')).toEqual([
      '```mermaid\ngraph TD;\nA-->B;\n```',
    ])
  })

  test('leaves a diagram fence as source while the caret is inside', () => {
    expect(blocks('```mermaid\ngraph TD;\n```', 14)).toEqual([])
  })

  test('leaves a normal code fence as code', () => {
    expect(concealed('```js\nlet x\n```')).toEqual(['```', 'js', '```'])
  })
})

describe('document integrity', () => {
  test('decorating never rewrites the document', () => {
    const doc = '# H\n\n**b** _i_ `c` [l](u)\n\n- [ ] t\n\n> q\n\n---\n\n```js\nx\n```\n'
    const before = state(doc, 0)
    buildDecorations(before)
    expect(before.doc.toString()).toBe(doc)
  })

  test('concealed ranges never overlap', () => {
    const doc = '# H\n\n![a](b) **c** `d`\n\n- [x] e\n\n| f |\n| - |\n| g |\n'
    const { atomic } = buildDecorations(state(doc, doc.length - 1))

    let previousEnd = -1
    atomic.between(0, doc.length, (from, to) => {
      expect(from).toBeGreaterThanOrEqual(previousEnd)
      previousEnd = to
    })
  })
})

describe('definition lists and abbreviations', () => {
  test('hides the colon that opens a definition', () => {
    expect(concealed('Term\n: a meaning')).toContain(':')
  })

  test('shows the colon again when the caret is on the line', () => {
    expect(concealed('Term\n: a meaning', 8)).not.toContain(':')
  })

  test('hides the punctuation around an abbreviation definition', () => {
    const hidden = concealed('*[HTML]: Markup')
    expect(hidden).toContain('*[')
    expect(hidden).toContain(']:')
  })

  test('leaves a bare colon in prose alone', () => {
    expect(concealed('Note: prose')).not.toContain(':')
  })
})

describe('inline code', () => {
  test('frames the span so it reads apart from prose', () => {
    expect(marked('run `npm test` now', 'nib-inline-code')).toEqual(['`npm test`'])
  })

  test('leaves a fenced block to the block styling', () => {
    expect(marked('```\nnpm test\n```', 'nib-inline-code')).toEqual([])
  })

  test('still hides its backticks when the caret is away', () => {
    expect(concealed('a `code` b')).toEqual(['`', '`'])
  })
})

describe('an unclosed fence', () => {
  const doc = '```\n# Title\n\n**bold**'

  test('conceals nothing of its own', () => {
    expect(concealed(doc)).toEqual(['# ', '**', '**'])
  })

  test('does not restyle the lines below it as code', () => {
    expect(lineClasses(doc)).not.toContain('nib-code')
    expect(lineClasses(doc)).toContain('nib-h1')
  })

  test('is styled as code once closed', () => {
    expect(lineClasses('```\n# Title\n```')).toContain('nib-code')
    expect(lineClasses('```\n# Title\n```')).not.toContain('nib-h1')
  })
})
