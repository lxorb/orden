import { expect, test } from 'vitest'
import { LanguageDescription } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { fenceLanguage, fenceLanguages } from './languages'
import { ordenMarkdownExtensions } from './markdown/extensions'

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'comment' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'function' },
  { tag: [tags.operator, tags.punctuation], class: 'punctuation' },
  { tag: tags.propertyName, class: 'property' },
])

function coloured(word: string, code: string): number {
  const document = `Before.\n\n\`\`\`${word}\n${code}\n\`\`\`\n\nAfter.\n`
  const parser = markdown({
    base: markdownLanguage,
    codeLanguages: fenceLanguage,
    extensions: ordenMarkdownExtensions,
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

  expect(coloured('py', CODE)).toBe(0)

  const found = await python!.load()
  const known = await fenceLanguages()
  const stock = LanguageDescription.matchLanguageName(known, 'py', true)
  expect(stock?.name).toBe('Python')
  expect(found.language.name).toBe((await stock!.load()).language.name)

  expect((await nothing!.load()).language.name).toBe('plaintext')
})

test('and the same fence is coloured once the list is here', () => {
  expect(fenceLanguage('py')?.name).toBe('Python')
  expect(coloured('py', CODE)).toBeGreaterThan(0)

  expect(fenceLanguage('gibberishlang')).toBeNull()
})
