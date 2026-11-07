import { describe, expect, test } from 'vitest'
import { LanguageDescription } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { fenceLanguages } from './languages'
import { ordenMarkdownExtensions } from './markdown/extensions'

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'comment' },
  { tag: tags.definition(tags.variableName), class: 'property' },
  { tag: [tags.function(tags.variableName), tags.labelName], class: 'function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'type' },
  { tag: [tags.operator, tags.punctuation], class: 'punctuation' },
  { tag: tags.propertyName, class: 'property' },
  { tag: tags.inserted, class: 'inserted' },
  { tag: tags.deleted, class: 'deleted' },
])

async function colouring(word: string, code: string) {
  const languages = await fenceLanguages()
  const description = LanguageDescription.matchLanguageName(languages, word, true)
  await description?.load()

  const document = `Before.\n\n\`\`\`${word}\n${code}\n\`\`\`\n\nAfter.\n`
  const parser = markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: ordenMarkdownExtensions,
  }).language.parser

  const from = document.indexOf(code)
  const groups = new Set<string>()
  let coloured = 0

  highlightTree(
    parser.parse(document),
    highlighter,
    (start, end, classes) => {
      if (start < from || end > from + code.length) return
      coloured += end - start
      for (const group of classes.split(' ')) groups.add(group)
    },
    from,
    from + code.length,
  )

  return { groups: [...groups].sort(), share: coloured / code.length }
}

const fences: [string, string, string[]][] = [
  [
    'py',
    'def greet(name):\n    # hello\n    return f"hi {name}"',
    ['comment', 'keyword', 'string'],
  ],
  ['rs', 'fn main() {\n    let n: u32 = 3; // three\n}', ['comment', 'keyword', 'number']],
  ['kt', 'fun main() {\n    val greeting = "hi"\n}', ['keyword', 'string']],
  [
    'zig',
    'pub fn main() void {\n    // a comment\n    const n: u32 = 3;\n}',
    ['comment', 'keyword', 'number'],
  ],
  ['awk', '# sum\nBEGIN { total = 0 }', ['comment', 'keyword']],
  ['glsl', 'void main() {\n    // red\n    gl_FragColor = vec4(1.0);\n}', ['comment', 'keyword']],
  ['elixir', 'defmodule A do\n  def hi(name), do: IO.puts("hi")\nend', ['keyword', 'string']],
  ['nix', '# a shell\npkgs.mkShell { buildInputs = [ pkgs.git ]; }', ['comment', 'punctuation']],
  [
    'terraform',
    '# an instance\nresource "aws_instance" "web" {\n  count = 3\n}',
    ['comment', 'number', 'type'],
  ],
  ['solidity', '// a contract\npragma solidity ^0.8.20;', ['comment', 'keyword']],
  ['svelte', '<script>\n  let n = 0\n</script>\n\n<b>{n}</b>', ['keyword', 'number']],
  [
    'makefile',
    '# build\nCC := gcc\nall: main.c\n\t$(CC) main.c',
    ['comment', 'function', 'property', 'punctuation'],
  ],
  ['graphql', '# a schema\ntype User {\n  id: ID!\n}', ['comment', 'keyword', 'property', 'type']],
  [
    'prisma',
    '// a model\nmodel User {\n  id Int @id\n}',
    ['comment', 'keyword', 'property', 'type'],
  ],
  ['console', '$ echo "done"\nDone in 2s', ['string']],
  ['jsonc', '{\n  "name": "orden"\n}', ['property', 'string']],
  ['helm', 'metadata:\n  name: orden\n  replicas: 3', ['property']],
  ['proto', 'message Note {\n  string id = 1;\n}', ['keyword', 'number']],
  ['env', 'API_KEY=secret\n# a note\nPORT=8080', ['comment', 'property']],
  ['ini', '[server]\nhost = localhost\nport = 8080', ['property']],
  ['diff', '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old line\n+new line', ['deleted', 'inserted']],
]

describe('a fence, coloured the way the editor colours it', () => {
  for (const [word, code, wanted] of fences) {
    test(`\`\`\`${word}`, async () => {
      const { groups, share } = await colouring(word, code)

      for (const group of wanted) expect(groups, `${word}: ${groups.join()}`).toContain(group)
      expect(share, `${word} coloured share`).toBeGreaterThan(0.1)
    })
  }

  test('a fence in a language nobody knows is left plain', async () => {
    const { groups, share } = await colouring('no-such-language', 'a b c\n"d"')

    expect(groups).toEqual([])
    expect(share).toBe(0)
  })
})
