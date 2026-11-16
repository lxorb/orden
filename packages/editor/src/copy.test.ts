import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { copiedFlavours, MOST_DRAWN, readyToCopy } from './copy'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => readyToCopy())

function state(doc: string, from: number, to: number, readOnly = false) {
  return EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    ...(readOnly ? { extensions: [EditorState.readOnly.of(true)] } : {}),
  })
}

describe('what a copy leaves on the clipboard', () => {
  test('the markdown as it was written', () => {
    expect(copiedFlavours(state('a **bold** word', 0, 15))?.text).toBe('a **bold** word')
  })

  test('and the same words as HTML, for whatever reads that instead', () => {
    expect(copiedFlavours(state('a **bold** word', 0, 15))?.html).toContain('<strong>bold</strong>')
  })

  test('a note too long to draw at once leaves its words alone, not a frozen window', () => {
    const long = 'a line with *some* words in it\n'.repeat(Math.ceil(MOST_DRAWN / 20))
    const flavours = copiedFlavours(state(long, 0, long.length))

    expect(flavours?.text).toBe(long)
    expect(flavours?.html).toBeNull()
  })

  test('a heading and a list arrive as a heading and a list', () => {
    const html = copiedFlavours(state('# Head\n\n- one\n- two', 0, 19))?.html ?? ''

    expect(html).toContain('<h1')
    expect(html).toContain('<li>one</li>')
  })

  test('part of a line is that part, not the line', () => {
    const flavours = copiedFlavours(state('one two three', 4, 7))
    expect(flavours?.text).toBe('two')
    expect(flavours?.html).toContain('two')
  })

  test('a comment is in the markdown and not in the HTML', () => {
    const doc = 'words <!-- to myself --> more'
    const flavours = copiedFlavours(state(doc, 0, doc.length))

    expect(flavours?.text).toContain('to myself')
    expect(flavours?.html).not.toContain('to myself')
  })
})

describe('when CodeMirror’s own copy is the better one', () => {
  test('nothing is selected', () => {
    expect(copiedFlavours(state('words', 3, 3))).toBeNull()
  })

  test('several places are selected at once, which it joins line by line', () => {
    const many = EditorState.create({
      doc: 'one\ntwo\nthree',
      selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })

    expect(copiedFlavours(many)).toBeNull()
  })

  test('a cut out of a note nothing may be written into', () => {
    expect(copiedFlavours(state('one two', 0, 3, true), true)).toBeNull()
    expect(copiedFlavours(state('one two', 0, 3, true))?.text).toBe('one')
  })
})

describe('copying words picked inside code', () => {
  function picked(doc: string, words: string): EditorState {
    const from = doc.indexOf(words)
    return parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.range(from, from + words.length),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
      }),
    )
  }

  const doc = 'Setup:\n\n```sh\n# install the tools\npip install *requests*\n```\n'
  const code = '# install the tools\npip install *requests*'

  test('the HTML flavour keeps a shell comment in a code block as code, not a heading', () => {
    const html = copiedFlavours(picked(doc, code))?.html ?? ''
    expect(html).not.toContain('<h1')
    expect(html).toContain('<pre><code class="language-sh"># install the tools')
  })

  test('the HTML flavour keeps the stars of a code block, not italics', () => {
    const html = copiedFlavours(picked(doc, code))?.html ?? ''
    expect(html).toContain('*requests*')
  })

  test('the HTML flavour keeps words inside inline code as code', () => {
    const html = copiedFlavours(picked('Run `pip *x* <y>` now', 'pip *x* <y>'))?.html ?? ''
    expect(html).toContain('<code>pip *x* &lt;y&gt;</code>')
  })
})
