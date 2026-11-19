import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { buildDecorations } from './decorate'
import { FenceHeaderWidget } from './widgets'
import { buildBlockDecorations } from './blocks'
import { trustedMarkup } from '../markup'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const PARK = '\n\nx'
function state(doc: string, cursor: number, trusted = false) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), trustedMarkup(trusted)],
    }),
  )
}
interface Spec {
  class?: string
  widget?: unknown
  attributes?: Record<string, string>
}
type Pick = (text: string, spec: Spec, from: number, to: number) => string | string[] | undefined
function walk(doc: string, cursor: number | undefined, pick: Pick, layer = 'decorations', trusted = false) {
  const full = cursor === undefined ? doc + PARK : doc
  const built = state(full, cursor ?? full.length, trusted)
  const set =
    layer === 'blocks'
      ? buildBlockDecorations(built)
      : buildDecorations(built)[layer === 'atomic' ? 'atomic' : 'decorations']
  const out: string[] = []
  set.between(0, full.length, (from, to, value) => {
    out.push(...[pick(full.slice(from, to), value.spec as Spec, from, to) ?? []].flat())
  })
  return out
}
const concealed = (doc: string, cursor?: number, trusted = false) =>
  walk(doc, cursor, (text) => text, 'atomic', trusted)
const blocks = (doc: string, cursor?: number, trusted = false) => walk(doc, cursor, (text) => text, 'blocks', trusted)
const marked = (doc: string, className: string, cursor?: number) =>
  walk(doc, cursor, (text, spec) => (spec.class === className ? text : undefined))
const revealedMeta = (doc: string, cursor: number) => marked(doc, 'md-meta', cursor)
const lineAttrs = (doc: string) =>
  walk(doc, undefined, (_, spec, from, to) =>
    from === to && !spec.widget ? (spec.attributes?.['data-callout'] ?? '') || undefined : undefined,
  )
const lineClasses = (doc: string) =>
  walk(doc, undefined, (_, spec, from, to) =>
    from === to && !spec.widget && spec.class ? spec.class.split(' ') : undefined,
  )
const conceals = (rows: [string, string[], (number | undefined)?, boolean?][]) =>
  test.each(rows)('%j', (doc, wanted, ...rest) => expect(concealed(doc, ...rest)).toEqual(wanted))
const blocksOf = (rows: [string, string[], (number | undefined)?, boolean?][]) =>
  test.each(rows)('%j', (doc, wanted, ...rest) => expect(blocks(doc, ...rest)).toEqual(wanted))
describe('headings', () => {
  conceals([
    ['# Title', ['# ']],
    ['###### Six', ['###### ']],
  ])
  test('reveals the hash when the caret is on the heading line', () => {
    expect(concealed('# Title\n\nbody', 3)).toEqual([])
    expect(revealedMeta('# Title\n\nbody', 3)).toEqual(['# '])
  })
})
describe('inline emphasis', () => {
  conceals([
    ['a **bold** b', ['**', '**']],
    ['_i_ ~~s~~ H~2~O X^2^', ['_', '_', '~~', '~~', '~', '~', '^', '^']],
  ])
  test('reveals only the span the caret sits in', () => {
    const doc = '**one** and **two**'
    expect(revealedMeta(doc, 3)).toEqual(['**', '**'])
    expect(concealed(doc, 3)).toEqual(['**', '**'])
  })
})
describe('links', () => {
  test('leaves only the label visible', () => {
    expect(concealed('see [docs](https://x.dev "t") now')).toEqual(['[', ']', '(', 'https://x.dev', '"t"', ')'])
  })
})
describe('code', () => {
  conceals([
    ['run `npm i` first', ['`', '`']],
    ['```js\nlet x\n```', ['```', 'js', '```']],
    ['```js\nlet x\n```', ['```', 'js', '```']],
  ])
  test('reveals both fence markers when the caret is on the opening line', () => {
    expect(revealedMeta('```js\nlet x\n```\n', 2)).toEqual(['```', 'js', '```'])
  })
  conceals([
    ['```js\nlet x\n```\n', [], 8],
    ['```js\nlet x\n```\n', [], 14],
  ])
  test('leaves a neighbouring fence hidden', () => {
    const doc = '```js\na\n```\n\n```py\nb\n```\n'
    expect(concealed(doc, 8)).toEqual(['```', 'py', '```'])
  })
})
describe('code line numbers', () => {
  function gutter(doc: string): { number: string | null; digits: string | undefined }[] {
    const full = doc + PARK
    const out: { number: string | null; digits: string | undefined }[] = []
    buildDecorations(state(full, full.length)).decorations.between(0, full.length, (from, to, value) => {
      const spec = value.spec as Spec
      if (from !== to || spec.widget || !spec.class?.split(' ').includes('orden-code')) return
      out.push({
        number: spec.attributes?.['data-code-number'] ?? null,
        digits: spec.attributes?.style,
      })
    })
    return out
  }
  function numbers(doc: string): (string | null)[] {
    return gutter(doc).map((line) => line.number)
  }
  test.each([
    ['```js\nlet a = 1\nlet b = 2\n```', [null, '1', '2', null]],
    ['text\n\n    a\n    b\n    c', ['1', '2', '3']],
    ['```\na\n\nb\n```', [null, '1', '2', '3', null]],
    ['```mermaid\ngraph TD\nA-->B\n```', []],
  ])('%j', (input, wanted) => expect(numbers(input)).toEqual(wanted))
  test('counts from one per block rather than per note', () => {
    const doc = 'words\n\n```\na\nb\n```\n\nmore\n\n```\nc\n```'
    expect(numbers(doc)).toEqual([null, '1', '2', null, null, '1', null])
  })
  test('the column is as wide as the block needs and no wider', () => {
    const nine = `\`\`\`\n${'a\n'.repeat(9)}\`\`\``
    expect(gutter(nine).map((line) => line.digits)).toEqual(Array.from({ length: 11 }, () => '--code-digits:1'))
    const ten = `\`\`\`\n${'a\n'.repeat(10)}\`\`\``
    expect(new Set(gutter(ten).map((line) => line.digits))).toEqual(new Set(['--code-digits:2']))
    expect(gutter('x\n\n```\na\n```').every((line) => line.digits === '--code-digits:1')).toBe(true)
  })
  test('the number rides on the line, so nothing selects or copies it', () => {
    const doc = '```\nlet a = 1\n```'
    const full = doc + PARK
    let carried = 0
    buildDecorations(state(full, full.length)).decorations.between(0, full.length, (from, to, value) => {
      const spec = value.spec as Spec
      if (!spec.attributes?.['data-code-number']) return
      carried += 1
      expect(from).toBe(to)
      expect(spec.widget).toBeUndefined()
    })
    expect(carried).toBe(1)
  })
})
describe('an <iframe> in the text', () => {
  const TAG = '<iframe src="https://field.example.test/plan"></iframe>'
  conceals([
    [TAG, [TAG]],
    [`See ${TAG} here.`, [TAG.slice(0, -9), '</iframe>']],
    ['<iframe src="javascript:alert(1)"></iframe>', []],
    ['<iframe></iframe>', []],
  ])
  conceals([
    [TAG, [], 10],
    [`See ${TAG} here.`, [], 10],
    [`See ${TAG} here.`, [], 4 + TAG.length - 4],
  ])
})
describe('escapes', () => {
  conceals([
    ['a \\* b', ['\\']],
    ['a \\< b', ['\\']],
    ['a \\[x] b', ['\\']],
    ['a \\ b', []],
    ['`a \\* b`', ['`', '`']],
  ])
  test('shows it again with the caret on it', () => {
    expect(concealed('a \\* b', 3)).toEqual([])
  })
})
describe('blocks', () => {
  conceals([
    ['> quoted', ['> ']],
    ['a\n\n---', ['---']],
    ['- one\n- two', ['-', '-']],
    ['- [x] done', ['- ', '[x]']],
  ])
  test('replaces the whole table with a rendered one', () => {
    expect(blocks('| a |\n| - |\n| 1 |')).toEqual(['| a |\n| - |\n| 1 |'])
    expect(concealed('| a |\n| - |\n| 1 |')).toEqual([])
  })
  test('falls back to source while the caret is in the table', () => {
    expect(blocks('| a |\n| - |\n| 1 |', 8)).toEqual([])
  })
})
describe('images', () => {
  conceals([
    ['![alt](pic.png)', ['![alt](pic.png)']],
    ['text <span>plain</span> more', []],
    ['![](https://example.test/a.png)', ['![](https://example.test/a.png)']],
  ])
  test('shows the source once the caret enters it', () => {
    expect(concealed('![alt](pic.png)', 3)).toEqual([])
    expect(revealedMeta('![alt](pic.png)', 3)).toEqual(['![', ']', '(', 'pic.png', ')'])
  })
  conceals([
    ['![alt](pic.png)', ['![alt](pic.png)'], 0],
    ['![alt](pic.png)', ['![alt](pic.png)'], 15],
  ])
  test('stays a picture while it is selected', () => {
    const doc = '![alt](pic.png)'
    const selected = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.range(0, doc.length),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
      }),
    )
    const out: string[] = []
    buildDecorations(selected).atomic.between(0, doc.length, (from, to) => {
      out.push(doc.slice(from, to))
    })
    expect(out).toEqual([doc])
  })
  test.each([
    ['text <img src="pic.png" alt="a" style="zoom:60%" /> more', ['<img src="pic.png" alt="a" style="zoom:60%" />']],
    ['a\n\n<div style="page-break-after: always;"></div>\n\nb', ['<div style="page-break-after: always;"></div>']],
  ])('%j', (input, wanted) => expect(concealed(input)).toEqual(wanted))
  test.each([
    ['```flow\nst=>start: Go\n```', ['```flow\nst=>start: Go\n```']],
    ['```chart\nseries:\n  - data: [1, 2]\n```', ['```chart\nseries:\n  - data: [1, 2]\n```']],
    ['```chart\nnot a chart\n```', []],
  ])('%j', (input, wanted) => expect(blocks(input)).toEqual(wanted))
  test('an address a provider answers for is that page, not a picture', () => {
    const written = '![](https://youtu.be/dQw4w9WgXcQ)'
    expect(concealed(written)).toEqual([written])
    expect(concealed(written, 4)).toEqual([])
  })
})
describe('extensions', () => {
  conceals([
    ['mass $E=mc^2$ here', ['$E=mc^2$']],
    ['ship it :rocket: now', [':rocket:']],
    ['a :not_an_emoji_name: b', []],
    ['a ==marked== b', ['==', '==']],
    ['text[^1] more', ['[^', ']']],
    ['> [!NOTE]\n> careful', ['> ', '[!NOTE]', '> ']],
    ['> [!warning]- Shut\n> behind it', ['> ', '[!warning]-', '> ']],
    ['> [!warning]+ Open\n> in front', ['> ', '[!warning]+', '> ']],
    ['<!-- a note -->', ['<!-- a note -->']],
    ['words <!-- aside --> more', ['<!-- aside -->']],
    ['%% a note %%', ['%% a note %%']],
    ['words %% aside %% more', ['%% aside %%']],
    ['a 50%% b', []],
    ['```js\nlet x\n```', ['```', 'js', '```']],
  ])
  test('reveals math source when the caret enters it', () => {
    expect(revealedMeta('mass $E=mc^2$ here', 8)).toEqual(['$', '$'])
  })
  blocksOf([
    ['$$\nE = mc^2\n$$', ['$$\nE = mc^2\n$$']],
    ['$$E = mc^2$$', ['$$E = mc^2$$']],
    ['```mermaid\ngraph TD;\nA-->B;\n```', ['```mermaid\ngraph TD;\nA-->B;\n```']],
  ])
  conceals([
    ['ship :rocket: now', [], 8],
    ['%% a note %%\n\nbody', [], 4],
    ['<!-- a note -->\n\nbody', [], 6],
  ])
  test('writes front matter out as it is, fences and all, the caret in it or not', () => {
    const note = '---\ntitle: Hi\n---\n\nbody'
    expect(blocks(note)).toEqual([])
    expect(blocks(note, 6)).toEqual([])
    expect(concealed(note)).toEqual([])
  })
  test('marks a callout with the look it wears, an alias resolved', () => {
    expect(lineClasses('> [!tldr]\n> the short of it')).toContain('orden-callout-abstract')
  })
  test('marks a type it has never heard of as a callout, with no look at all', () => {
    const classes = lineClasses('> [!recipe]\n> flour and water')
    expect(classes).toContain('orden-callout')
    expect(classes.some((one) => one.startsWith('orden-callout-'))).toBe(false)
  })
  test.each([
    ['> [!recipe]\n> flour and water', 'recipe'],
    ['> [!TLDR]\n> the short of it', 'tldr'],
  ])('%j', (input, wanted) => expect(lineAttrs(input)).toContain(wanted))
  test('leaves a quote that names no type a quote', () => {
    expect(lineClasses('> just a quote')).not.toContain('orden-callout')
  })
  test('shows a comment written across lines rather than hiding it', () => {
    for (const doc of ['%%\nmulti\nline\n%%', '<!--\nmulti\nline\n-->', 'a <!-- c\nd --> b', 'a %%c\nd%% b']) {
      expect(concealed(doc)).toEqual([])
      expect(revealedMeta(doc + PARK, doc.length + PARK.length)).not.toEqual([])
    }
  })
  test('replaces nothing across a line break, whatever was written', () => {
    for (const doc of [
      '<img\n  src="a.png">',
      '<iframe\nsrc="https://example.com">',
      '![a\nb](a.png)',
      'x <span\nclass="a">y</span>',
    ]) {
      const full = doc + PARK
      for (const trusted of [false, true]) {
        const { decorations } = buildDecorations(state(full, full.length, trusted))
        decorations.between(0, full.length, (from, to, value) => {
          if (value.spec.class === undefined && from < to) expect(full.slice(from, to), doc).not.toContain('\n')
        })
      }
    }
  })
  test('leaves a diagram fence as source while the caret is inside', () => {
    expect(blocks('```mermaid\ngraph TD;\n```', 14)).toEqual([])
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
  test.each([
    ['run `npm test` now', ['`npm test`'], 'orden-inline-code'],
    ['```\nnpm test\n```', [], 'orden-inline-code'],
  ])('%j', (input, wanted, ...more) => expect(marked(input, ...more)).toEqual(wanted))
  test('still hides its backticks when the caret is away', () => {
    expect(concealed('a `code` b')).toEqual(['`', '`'])
  })
})
describe('headings', () => {
  test('every depth styles its line as that depth', () => {
    for (let depth = 1; depth <= 6; depth++)
      expect(lineClasses(`${'#'.repeat(depth)} Title`)).toContain(`orden-h${depth}`)
  })
  test('a line with = or - under it is no heading, only a hash makes one', () => {
    for (const doc of ['Title\n=====', 'Title\n-----', 'Title\n-', 'Title\n- item']) {
      expect(
        lineClasses(doc).filter((one) => one.startsWith('orden-h')),
        doc,
      ).toEqual([])
    }
  })
  test('seven hashes are not a heading', () => {
    expect(lineClasses('####### Title').filter((one) => one.startsWith('orden-h'))).toEqual([])
  })
})
describe('an unclosed fence', () => {
  const doc = '```\n# Title\n\n**bold**'
  test('conceals nothing of its own', () => {
    expect(concealed(doc)).toEqual(['# ', '**', '**'])
  })
  test('does not restyle the lines below it as code', () => {
    expect(lineClasses(doc)).not.toContain('orden-code')
    expect(lineClasses(doc)).toContain('orden-h1')
  })
  test('is styled as code once closed', () => {
    expect(lineClasses('```\n# Title\n```')).toContain('orden-code')
    expect(lineClasses('```\n# Title\n```')).not.toContain('orden-h1')
  })
})
describe('links', () => {
  function linkMarks(doc: string, cursor?: number): { text: string; href: string | null }[] {
    const full = cursor === undefined ? doc + PARK : doc
    const out: { text: string; href: string | null }[] = []
    buildDecorations(state(full, cursor ?? full.length)).decorations.between(0, full.length, (from, to, value) => {
      if (value.spec.class === 'orden-link') {
        out.push({
          text: full.slice(from, to),
          href: value.spec.attributes?.['data-href'] ?? null,
        })
      }
    })
    return out
  }
  test.each([
    ['see [docs](https://x.dev) now', [{ text: 'docs', href: 'https://x.dev' }]],
    ['see https://a.test/?b=\\[1\\] now', [{ text: 'https://a.test/?b=\\[1\\]', href: 'https://a.test/?b=[1]' }]],
    ['see https://a.test/a\\`b now', [{ text: 'https://a.test/a\\`b', href: 'https://a.test/a`b' }]],
    ['(see https://a.test/a_b\\_) now', [{ text: 'https://a.test/a_b\\', href: 'https://a.test/a_b' }]],
    ['see <https://a.test/\\[1\\]> now', [{ text: 'https://a.test/\\[1\\]', href: 'https://a.test/\\[1\\]' }]],
    ['see www.w.dev now', [{ text: 'www.w.dev', href: 'https://www.w.dev' }]],
    ['see [below](#heading) now', [{ text: 'below', href: null }]],
    ['see [other](notes/other.md) now', []],
  ])('%j', (input, wanted) => expect(linkMarks(input)).toEqual(wanted))
  test('words in brackets with nothing defined for them keep their brackets', () => {
    const doc = 'He said [sic] it, see [1] and [TODO].'
    expect(concealed(doc)).toEqual([])
    expect(linkMarks(doc)).toEqual([])
  })
  test('the marker of a callout is not a link', () => {
    expect(linkMarks('> [!note] Title\n> body')).toEqual([])
  })
  test('a reference link shows its words and follows its definition', () => {
    const doc = 'see [text][ref] and [ref] here\n\n[ref]: https://x.com'
    expect(concealed(doc)).toEqual(['[', ']', '[ref]', '[', ']', ':'])
    expect(linkMarks(doc)).toEqual([
      { text: 'text', href: 'https://x.com' },
      { text: 'ref', href: 'https://x.com' },
      { text: 'https://x.com', href: 'https://x.com' },
    ])
  })
  test('the label of a link carries its target', () => {
    expect(linkMarks('see [docs](https://x.dev) now')).toEqual([{ text: 'docs', href: 'https://x.dev' }])
  })
  test('a bare address stays visible and is the link', () => {
    const doc = 'go to https://bare.dev/p?q=1 now'
    expect(concealed(doc)).toEqual([])
    expect(linkMarks(doc)).toEqual([{ text: 'https://bare.dev/p?q=1', href: 'https://bare.dev/p?q=1' }])
  })
  test('an autolink hides its brackets and shows the address', () => {
    const doc = 'see <https://angle.dev> now'
    expect(concealed(doc)).toEqual(['<', '>'])
    expect(linkMarks(doc)).toEqual([{ text: 'https://angle.dev', href: 'https://angle.dev' }])
  })
})
describe('underline', () => {
  test('hides both tags and underlines the text between them', () => {
    expect(concealed('a <u>under lined</u> b')).toEqual(['<u>', '</u>'])
    expect(marked('a <u>under lined</u> b', 'orden-underline')).toEqual(['under lined'])
  })
  test('shows the tags while the caret is between them', () => {
    expect(concealed('a <u>under lined</u> b', 8)).toEqual([])
    expect(revealedMeta('a <u>under lined</u> b', 8)).toEqual(['<u>', '</u>'])
  })
  test('pairs nested underlines from the inside out', () => {
    expect(concealed('<u>a <u>b</u> c</u>')).toEqual(['<u>', '<u>', '</u>', '</u>'])
    expect(marked('<u>a <u>b</u> c</u>', 'orden-underline')).toEqual(['a <u>b</u> c', 'b'])
  })
  test('leaves an opener without a closer alone', () => {
    expect(concealed('a <u>open b')).toEqual([])
    expect(marked('a <u>open b', 'orden-underline')).toEqual([])
  })
  test('leaves other inline tags alone', () => {
    expect(concealed('a <b>bold</b> b')).toEqual([])
  })
})
const BODY = 'const x = 1 // padding to make this line long enough to matter\n'.repeat(16)
const MANY_FENCES = Array.from({ length: 10 }, () => `\`\`\`js\n${BODY}\`\`\`\n\n`).join('')
function headers(doc: string, cursor: number): FenceHeaderWidget[] {
  const { decorations } = buildDecorations(state(doc, cursor))
  const found: FenceHeaderWidget[] = []
  decorations.between(0, doc.length, (_from, _to, value) => {
    const widget: unknown = value.spec.widget
    if (widget instanceof FenceHeaderWidget) found.push(widget)
  })
  return found
}
function slicedWhileBuilding(doc: string, cursor: number): number {
  const built = state(doc, cursor)
  const text = built.doc
  const real = text.sliceString.bind(text)
  let chars = 0
  Object.defineProperty(text, 'sliceString', {
    configurable: true,
    value: (from: number, to?: number, lineSep?: string) => {
      chars += (to ?? text.length) - from
      return real(from, to, lineSep)
    },
  })
  buildDecorations(built)
  return chars
}
describe('what a keystroke in a note full of code costs', () => {
  test('the headers read none of the code they sit on', () => {
    expect(headers(MANY_FENCES, MANY_FENCES.length)).toHaveLength(10)
    expect(slicedWhileBuilding(MANY_FENCES, MANY_FENCES.length)).toBeLessThan(BODY.length)
  })
  test('and typing inside a block leaves its header as it was', () => {
    const one = headers('```js\nlet a = 1\n```\n\nx', 22)[0]
    const other = headers('```js\nlet a = 12\n```\n\nx', 23)[0]
    expect(one && other && one.eq(other)).toBe(true)
  })
  test('but a header whose own words changed is drawn again', () => {
    const one = headers('```js\nlet a = 1\n```\n\nx', 22)[0]
    const other = headers('```ts setup\nlet a = 1\n```\n\nx', 28)[0]
    expect(one && other && one.eq(other)).toBe(false)
  })
})
describe('an interactive block of HTML', () => {
  const BLOCK = '<div id="here"></div>\n<script>document.body.textContent = 1</script>'
  blocksOf([
    [BLOCK, [BLOCK], undefined, true],
    [BLOCK, [], 4, true],
    ['<div class="card">\n  <p>Wind.</p>\n</div>', [], undefined, true],
  ])
  test('stays the characters it is made of where the HTML is not trusted', () => {
    expect(blocks(BLOCK)).toEqual([])
  })
  test('is the card whatever the note wrote around the script', () => {
    const inline = '<div>\n<script>\nlet a = 1\n</script>\n</div>'
    expect(blocks(inline, undefined, true)).toEqual([inline])
  })
  test('is not an inline replacement, which the library would refuse', () => {
    expect(concealed(BLOCK, undefined, true)).toEqual([])
  })
})
