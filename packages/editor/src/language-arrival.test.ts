import { expect, test } from 'vitest'
import { LanguageDescription } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { fenceLanguage, fenceLanguages } from './languages'
import { nibMarkdownExtensions } from './markdown/extensions'

/** A fence named before the list of languages is here.
 *
 *  The list is a hundred and forty-three descriptions and the vocabulary over them,
 *  and it is fetched when a fence first names a language rather than before the window
 *  has drawn anything. Which means there is a moment - the first fence in a run of the
 *  app, for as long as one fetch takes - when the parser asks what a word means and
 *  nothing here knows yet.
 *
 *  What it gets is a description named after the word, whose own `load` waits for the
 *  list: CodeMirror skips a region whose parser is still on its way and parses it
 *  again when it arrives. So the fence is plain text and then coloured, which is
 *  exactly what a fence of a language nobody has loaded yet already did - all 143 of
 *  them are fetched that same way.
 *
 *  This file is the cold half of it and nothing else, which is why it is its own file:
 *  the list is module state, and languages.test.ts awaits all of it on its first line.
 *  Order matters here - every test below that wants the list warm says so. */

/** The groups `code-theme.ts` paints, as names. Enough of the set to tell a coloured
 *  fence from a grey one; the whole of it is in languages.render.test.ts. */
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'comment' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'function' },
  { tag: [tags.operator, tags.punctuation], class: 'punctuation' },
  { tag: tags.propertyName, class: 'property' },
])

/** How many characters of a fence's code the editor colours, through the same
 *  `markdown({ codeLanguages })` the editor is built with - so the info word, the
 *  lookup and the nested parser are all in it. */
function coloured(word: string, code: string): number {
  const document = `Before.\n\n\`\`\`${word}\n${code}\n\`\`\`\n\nAfter.\n`
  const parser = markdown({
    base: markdownLanguage,
    codeLanguages: fenceLanguage,
    extensions: nibMarkdownExtensions,
  }).language.parser

  const from = document.indexOf(code)
  let painted = 0

  highlightTree(
    parser.parse(document),
    highlighter,
    (start, end) => {
      if (start < from || end > from + code.length) return
      painted += end - start
    },
    from,
    from + code.length,
  )

  return painted
}

const CODE = `def wind(speed):\n    return speed * 2  # knots\n`

test('a fence names a language before the list is here, and is plain until it lands', async () => {
  // Cold: nothing here knows what `py` means yet, so what comes back is named after
  // the word and has no parser of its own. Nor has a word nothing will ever answer
  // to, which is the same answer and has to keep the same promise.
  const python = fenceLanguage('py')
  const nothing = fenceLanguage('gibberishlang')

  for (const [word, asked] of [
    ['py', python],
    ['gibberishlang', nothing],
  ] as const) {
    expect(asked, word).not.toBeNull()
    expect(asked?.name).toBe(word)
    expect(asked?.support).toBeUndefined()
  }

  // And the document the fence is in parses with nothing coloured inside it, which is
  // the frame the reader sees while the list is on its way.
  expect(coloured('py', CODE)).toBe(0)

  // What the words meant all along, once the list has landed: each description loads
  // to whatever the whole list would have matched. `py` is Python; a word nothing
  // answers to is plain text, which is what the fence was already showing - said as a
  // language rather than as a rejection, because a rejection inside a parse is
  // nobody's to catch.
  const found = await python!.load()
  const known = await fenceLanguages()
  const stock = LanguageDescription.matchLanguageName(known, 'py', true)
  expect(stock?.name).toBe('Python')
  expect(found.language.name).toBe((await stock!.load()).language.name)

  expect((await nothing!.load()).language.name).toBe('plaintext')
})

test('and the same fence is coloured once the list is here', () => {
  // The list arrived in the test above, and this is the parse CodeMirror asks for
  // again when it did. Same document, same word, same lookup - and now a language.
  expect(fenceLanguage('py')?.name).toBe('Python')
  expect(coloured('py', CODE)).toBeGreaterThan(0)

  // Warm, a word nothing answers to is the lookup's own answer: no language at all,
  // and CodeMirror leaves the fence exactly as it had it.
  expect(fenceLanguage('gibberishlang')).toBeNull()
})
