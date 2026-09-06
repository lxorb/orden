import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { expect, test } from 'vitest'

/** Snapshots the parse tree so the decoration walker is written against the
 *  parser's real node names, and regressions in parser upgrades show up here. */
function dump(doc: string): string {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  const out: string[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      let indent = 0
      for (let parent = node.node.parent; parent; parent = parent.parent) indent++
      out.push(
        `${'  '.repeat(indent)}${node.name} ${JSON.stringify(doc.slice(node.from, node.to))}`,
      )
    },
  })

  return out.join('\n')
}

test('task list', () => {
  expect(dump('- [x] done\n- [ ] open\n')).toMatchInlineSnapshot(`
    "Document "- [x] done\\n- [ ] open\\n"
      BulletList "- [x] done\\n- [ ] open"
        ListItem "- [x] done"
          ListMark "-"
          Task "[x] done"
            TaskMarker "[x]"
        ListItem "- [ ] open"
          ListMark "-"
          Task "[ ] open"
            TaskMarker "[ ]""
  `)
})

test('inline', () => {
  expect(dump('a **b** _c_ ~~d~~ `e` [f](g "h") ![i](j) H~2~O X^2^\n')).toMatchInlineSnapshot(`
    "Document "a **b** _c_ ~~d~~ \`e\` [f](g \\"h\\") ![i](j) H~2~O X^2^\\n"
      Paragraph "a **b** _c_ ~~d~~ \`e\` [f](g \\"h\\") ![i](j) H~2~O X^2^"
        StrongEmphasis "**b**"
          EmphasisMark "**"
          EmphasisMark "**"
        Emphasis "_c_"
          EmphasisMark "_"
          EmphasisMark "_"
        Strikethrough "~~d~~"
          StrikethroughMark "~~"
          StrikethroughMark "~~"
        InlineCode "\`e\`"
          CodeMark "\`"
          CodeMark "\`"
        Link "[f](g \\"h\\")"
          LinkMark "["
          LinkMark "]"
          LinkMark "("
          URL "g"
          LinkTitle "\\"h\\""
          LinkMark ")"
        Image "![i](j)"
          LinkMark "!["
          LinkMark "]"
          LinkMark "("
          URL "j"
          LinkMark ")"
        Subscript "~2~"
          SubscriptMark "~"
          SubscriptMark "~"
        Superscript "^2^"
          SuperscriptMark "^"
          SuperscriptMark "^""
  `)
})

test('html', () => {
  expect(dump('a\n\n<div style="page-break-after: always;"></div>\n\nb')).toMatchInlineSnapshot(`
    "Document "a\\n\\n<div style=\\"page-break-after: always;\\"></div>\\n\\nb"
      Paragraph "a"
      HTMLBlock "<div style=\\"page-break-after: always;\\"></div>"
      Paragraph "b""
  `)
})

test('blocks', () => {
  expect(dump('# H\n\n> q\n\n---\n\n```js\nx\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'))
    .toMatchInlineSnapshot(`
    "Document "# H\\n\\n> q\\n\\n---\\n\\n\`\`\`js\\nx\\n\`\`\`\\n\\n| a | b |\\n| - | - |\\n| 1 | 2 |\\n"
      ATXHeading1 "# H"
        HeaderMark "#"
      Blockquote "> q"
        QuoteMark ">"
        Paragraph "q"
      HorizontalRule "---"
      FencedCode "\`\`\`js\\nx\\n\`\`\`"
        CodeMark "\`\`\`"
        CodeInfo "js"
        CodeText "x"
        CodeMark "\`\`\`"
      Table "| a | b |\\n| - | - |\\n| 1 | 2 |"
        TableHeader "| a | b |"
          TableDelimiter "|"
          TableCell "a"
          TableDelimiter "|"
          TableCell "b"
          TableDelimiter "|"
        TableDelimiter "| - | - |"
        TableRow "| 1 | 2 |"
          TableDelimiter "|"
          TableCell "1"
          TableDelimiter "|"
          TableCell "2"
          TableDelimiter "|""
  `)
})
