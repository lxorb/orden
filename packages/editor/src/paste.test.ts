import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { loadFor } from '@orden/markdown/engines'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { copiedFlavours, readyToCopy } from './copy'
import { nibMarkdownExtensions } from './markdown/extensions'
import { delimitedToTable, pastedMarkdown } from './paste'
import { placed, plainly } from './paste-place'
import { linkedPaste } from './paste-link'

// The renderer a copy writes its HTML with is fetched by the first selection; a test
// has none, so it waits for it here.
beforeAll(() => readyToCopy())

/** The conversion itself is `@orden/markdown/from-html`, tested there. What is
 *  tested here is the choosing: a clipboard carries two flavours at once, and
 *  which of them a paste reads decides what lands in the note.
 *
 *  Awaited, because the converter is fetched the first time a page is pasted and not
 *  before - so what a clipboard comes to is an answer rather than a value. The two
 *  flavours that need nothing fetched are still settled in the call: a spreadsheet,
 *  and a clipboard with no HTML on it at all. */
describe('what a clipboard comes to', () => {
  test('a page arrives as markdown', async () => {
    await expect(pastedMarkdown('<h2>Title</h2>', 'Title')).resolves.toBe('## Title')
  })

  test('a spreadsheet arrives as a table, from the plain text beside the HTML', async () => {
    const html = '<table><tr><td>Name</td><td>Size</td></tr><tr><td>a</td><td>1</td></tr></table>'
    await expect(pastedMarkdown(html, 'Name\tSize\na\t1')).resolves.toBe(
      ['| Name | Size |', '| --- | --- |', '| a | 1 |'].join('\n'),
    )
  })

  test('plain text with no HTML beside it is nothing to convert', async () => {
    await expect(pastedMarkdown('', 'just words')).resolves.toBeNull()
  })

  test('HTML that comes to nothing is nothing to insert', async () => {
    await expect(pastedMarkdown('<style>p{}</style>', '')).resolves.toBeNull()
  })
})

/** A copy out of this app puts both flavours on the clipboard itself - the note's
 *  own markdown, and the same words drawn; see copy.ts. The markdown is the better
 *  of the two, because it is what the note says down to the character, and a
 *  drawing is a one-way trip: converting one back guesses at the source it was
 *  made from and lands beside it. A formula is where it landed furthest, arriving
 *  as the symbols it had been drawn as. */
describe('a clipboard this app filled itself', () => {
  function copied(note: string) {
    const state = EditorState.create({
      doc: note,
      selection: EditorSelection.range(0, note.length),
    })
    const flavours = copiedFlavours(state)

    return { html: flavours?.html ?? '', text: flavours?.text ?? '' }
  }

  test('is pasted as the markdown that was copied, character for character', async () => {
    const note = String.raw`$$B_r(x) := \left\{ y \in \mathbb{R}^n \;\middle|\; \|x - y\| < r \right\}$$`
    // The engine, so that the HTML beside it is the drawing a copy really carries
    // rather than the source a copy falls back to before one has been loaded.
    await loadFor(note)
    const { html, text } = copied(note)

    expect(html).toContain('katex')
    await expect(pastedMarkdown(html, text)).resolves.toBe(note)
  })

  test('and everything else a note says that a drawing of it does not', async () => {
    const note = '> [!note] Ball\n> see [[Metrik]] and ==this==\n'
    const { html, text } = copied(note)

    await expect(pastedMarkdown(html, text)).resolves.toBe(note)
  })

  test('while a page from anywhere else is still converted', async () => {
    await expect(pastedMarkdown('<h2>Title</h2>', '# Something else')).resolves.toBe('## Title')
  })
})

describe('pasting spreadsheet cells', () => {
  test('tab-separated rows become a table', () => {
    expect(delimitedToTable('Name\tSize\na\t1\nb\t2')).toBe(
      ['| Name | Size |', '| --- | --- |', '| a | 1 |', '| b | 2 |'].join('\n'),
    )
  })

  test('comma-separated rows work too', () => {
    expect(delimitedToTable('a,b,c\n1,2,3')).toContain('| a | b | c |')
  })

  test('two sentences that happen to have a comma each are not a table', () => {
    // One comma per line is a sentence, and pasting prose was turning it into a
    // two-column table. A spreadsheet's tabs still settle it outright.
    expect(delimitedToTable('Hello, world\nGoodbye, world')).toBeNull()
    expect(delimitedToTable('Yes, it is\nNo, it is not')).toBeNull()
    expect(delimitedToTable('a\tb\n1\t2')).toContain('| a | b |')
  })

  test('a pipe inside a cell is escaped', () => {
    expect(delimitedToTable('a\tb\nx|y\tz')).toContain('x\\|y')
  })

  test('ordinary prose is left alone', () => {
    expect(delimitedToTable('Just a sentence.')).toBeNull()
    expect(delimitedToTable('One line\nAnother line')).toBeNull()
  })

  test('ragged rows are not a table', () => {
    expect(delimitedToTable('a\tb\n1')).toBeNull()
  })

  test('a single column is not a table', () => {
    expect(delimitedToTable('a\nb\nc')).toBeNull()
  })

  test('code indented with tabs is not a table', () => {
    expect(delimitedToTable('\tx := 1\n\ty := 2\n\treturn x + y')).toBeNull()
  })
})

/** An address pasted over selected words makes a link of them, and nothing else
 *  does: a paste with no selection, a paste of more than an address, and a paste
 *  into code or into a link that is already there all go in as they stand. */
describe('an address pasted over a selection', () => {
  /** What the note becomes, or null where the paste is left to go in as it stands.
   *  `«` and `»` in `marked` are the ends of the selection, since a link is written
   *  with the brackets. */
  function pasted(marked: string, text: string): string | null {
    const from = marked.indexOf('«')
    const to = marked.indexOf('»') - 1
    const state = parsed(
      EditorState.create({
        doc: marked.replace(/[«»]/g, ''),
        selection: EditorSelection.range(from, to),
        extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
      }),
    )

    const spec = linkedPaste(state, text)
    return spec ? state.update(spec).state.doc.toString() : null
  }

  const URL = 'https://example.com/a?b=c'

  test('links the words', () => {
    expect(pasted('Read «the docs» first.', URL)).toBe(`Read [the docs](${URL}) first.`)
  })

  test('reads the address past the whitespace a copy carries', () => {
    expect(pasted('«here»', ` ${URL}\n`)).toBe(`[here](${URL})`)
  })

  test('takes a mail address', () => {
    expect(pasted('«write»', 'mailto:a@b.ch')).toBe('[write](mailto:a@b.ch)')
  })

  test('keeps a balanced bracket in the address and fences an unbalanced one', () => {
    const wiki = 'https://en.wikipedia.org/wiki/Nib_(pen)'
    expect(pasted('«pen»', wiki)).toBe(`[pen](${wiki})`)
    expect(pasted('«pen»', 'https://a.ch/x)')).toBe('[pen](<https://a.ch/x)>)')
  })

  test('leaves anything but one address alone', () => {
    expect(pasted('«words»', 'not an address')).toBeNull()
    expect(pasted('«words»', `${URL} and more`)).toBeNull()
    expect(pasted('«words»', 'C:\\notes\\a.md')).toBeNull()
  })

  test('leaves a paste with nothing selected alone', () => {
    const state = EditorState.create({ doc: 'words', selection: EditorSelection.cursor(2) })
    expect(linkedPaste(state, URL)).toBeNull()
  })

  test('replaces a selected address rather than linking it', () => {
    expect(pasted('«https://old.ch»', URL)).toBeNull()
  })

  test('stays plain in inline code and in a code block', () => {
    expect(pasted('Run `«npm»` now.', URL)).toBeNull()
    expect(pasted('```\n«let x»\n```\n', URL)).toBeNull()
    expect(pasted('    «indented code»\n', URL)).toBeNull()
  })

  test('stays plain inside a link, a note link or a formula', () => {
    expect(pasted('[«te»xt](https://a.ch)', URL)).toBeNull()
    expect(pasted('[[«No»te]]', URL)).toBeNull()
    expect(pasted('$«x^2»$', URL)).toBeNull()
  })

  test('gives a bare www. the scheme a browser would', () => {
    expect(pasted('«site»', 'www.nib.ch')).toBe('[site](https://www.nib.ch)')
  })

  test('links words with markup in them, but not half of the markup', () => {
    expect(pasted('«some **bold** words»', URL)).toBe(`[some **bold** words](${URL})`)
    expect(pasted('«some **bo»ld** words', URL)).toBeNull()
    expect(pasted('- «one\n- two»', URL)).toBeNull()
  })

  test('escapes a plain bracket among the words, and leaves markup alone', () => {
    expect(pasted('see «a] b» now', URL)).toBe(`see [a\\] b](${URL}) now`)
    expect(pasted('«[x [y](https://a.ch) z»', URL)).toBe(`[\\[x [y](https://a.ch) z](${URL})`)
    expect(pasted('«a\\] `b]` [[c]] d»', URL)).toBe(`[a\\] \`b]\` [[c]] d](${URL})`)
  })

  test('does not reach across paragraphs', () => {
    expect(pasted('«one\n\ntwo»', URL)).toBeNull()
  })

  test('links every selection when there are several', () => {
    const state = parsed(
      EditorState.create({
        doc: 'one two',
        selection: EditorSelection.create([
          EditorSelection.range(0, 3),
          EditorSelection.range(4, 7),
        ]),
        extensions: [
          markdown({ base: markdownLanguage }),
          EditorState.allowMultipleSelections.of(true),
        ],
      }),
    )
    const spec = linkedPaste(state, URL)
    expect(spec && state.update(spec).state.doc.toString()).toBe(`[one](${URL}) [two](${URL})`)
  })
})

describe('where a paste lands', () => {
  const landed = (marked: string, text: string, how = placed) => {
    const at = marked.indexOf('|')
    const state = EditorState.create({ doc: marked.replace('|', ''), selection: { anchor: at } })
    const next = state.update(how(state, text)).state
    return { doc: next.doc.toString(), caret: next.selection.main.head }
  }

  const TABLE = '| a | b |\n| --- | --- |\n| c | d |'

  test('a block starting in a line starts on its own', () => {
    expect(landed('abc |', TABLE).doc).toBe(`abc\n\n${TABLE}`)
    expect(landed('abc |def', TABLE).doc).toBe(`abc\n\n${TABLE}\n\ndef`)
    expect(landed('abc def|', '## Head').doc).toBe('abc def\n\n## Head')
    expect(landed('abc |def', TABLE).caret).toBe(5 + TABLE.length)
  })

  test('inside a list item or a quote stays there', () => {
    expect(landed('- abc|', TABLE).doc).toBe(`- abc\n\n  ${TABLE.split('\n').join('\n  ')}`)
    expect(landed('> abc|', '## H\n\nx').doc).toBe('> abc\n>\n> ## H\n>\n> x')
  })

  test('words stay in the line', () => {
    expect(landed('abc |def', '**x** y').doc).toBe('abc **x** ydef')
    expect(landed('|', '## Head').doc).toBe('## Head')
    expect(landed('|def', '**x** y').doc).toBe('**x** ydef')
  })

  test('a heading does not take the words after it', () => {
    expect(landed('abc |def', 'x\n\n## Head').doc).toBe('abc x\n\n## Head\n\ndef')
  })

  test('a list on an empty item takes the item', () => {
    expect(landed('- |', '- x\n- y').doc).toBe('- x\n- y')
    expect(landed('- a\n- |', '- x\n- y').doc).toBe('- a\n- x\n- y')
    expect(landed('  - |', '- x\n- y').doc).toBe('  - x\n  - y')
    expect(landed('  - |', '- x\n  - y').doc).toBe('  - x\n    - y')
    expect(landed('> - |', '- x\n- y').doc).toBe('> - x\n> - y')
    expect(landed('- [ ] |', '- x').doc).toBe('- x')
    expect(landed('- |', '- x\n- y').caret).toBe(7)
  })

  test('anything else on an empty item stays under it', () => {
    expect(landed('- |', TABLE).doc).toBe(`- ${TABLE.split('\n').join('\n  ')}`)
    expect(landed('- |', 'one\n\ntwo').doc).toBe('- one\n\n  two')
  })

  test('plain text is itself unless it is a list on an empty item', () => {
    expect(landed('abc |', '## Head', plainly).doc).toBe('abc ## Head')
    expect(landed('- |', '- x\n- y', plainly).doc).toBe('- x\n- y')
    expect(landed('- |', 'x\ny', plainly).doc).toBe('- x\ny')
  })
})

describe('commas that are not a table', () => {
  test('two lines of prose are two lines of prose', () => {
    expect(delimitedToTable('Hello, world, again\nGoodbye, moon, soon')).toBeNull()
  })

  test('data written with a space after its commas is still data', () => {
    expect(delimitedToTable('Name, Age, City\nBob, 3, Paris')).toContain('| Bob | 3 | Paris |')
    expect(delimitedToTable('a,b,c\nd,e,f')).toContain('| d | e | f |')
  })
})

describe('a table with a line under the caret', () => {
  const at = (marked: string, text: string) => {
    const caret = marked.indexOf('|')
    const state = EditorState.create({ doc: marked.replace('|', ''), selection: { anchor: caret } })
    return state.update(placed(state, text)).state.doc.toString()
  }
  const TABLE = '| a | b |\n| --- | --- |\n| c | d |'

  test('keeps a blank line between them', () => {
    expect(at('abc|\nnext', TABLE)).toBe(`abc\n\n${TABLE}\n\nnext`)
    expect(at('|\nnext', TABLE)).toBe(`${TABLE}\n\nnext`)
    expect(at('abc|\n\nnext', TABLE)).toBe(`abc\n\n${TABLE}\n\nnext`)
  })

  test('and over it, on an empty line under words', () => {
    expect(at('above\n|', TABLE)).toBe(`above\n\n${TABLE}`)
  })
})
