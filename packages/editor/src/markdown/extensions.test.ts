import fenceTable from '../../../markdown/src/fence-table.json'
import { nibMarkdownParser } from './extensions'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../markdown/src/growth'
import { nibMarkdownExtensions } from './extensions'
import { parsed } from '../../test/parsed'

function stateFor(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
}

function treeOf(state: EditorState): string {
  const doc = state.doc.toString()
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

function tree(doc: string): string {
  return treeOf(stateFor(doc))
}

function namesOf(state: EditorState): string[] {
  return treeOf(state)
    .split('\n')
    .map((line) => line.trim().split(' ')[0] ?? '')
}

function names(doc: string): string[] {
  return namesOf(stateFor(doc))
}

describe('front matter being typed', () => {
  const language = markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })
  const top = (state: EditorState): string => {
    const out: string[] = []
    const tree = ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state)
    for (let at = tree.topNode.firstChild; at; at = at.nextSibling) {
      out.push(`${at.name}@${at.from}-${at.to}`)
    }
    return out.join(' ')
  }
  const fresh = (doc: string) => top(EditorState.create({ doc, extensions: [language] }))

  function typedAlong(doc: string, at: number, typed: string) {
    let state = EditorState.create({ doc, extensions: [language] })
    top(state)
    let from = at
    for (const one of typed) {
      state = state.update({ changes: { from, insert: one }, userEvent: 'input.type' }).state
      from += one.length
      expect(top(state), JSON.stringify(state.doc.toString())).toBe(fresh(state.doc.toString()))
    }
    return state
  }

  test.each([60, 100, 120, 126, 130, 132, 140, 160, 200, 400, 1000, 6000])(
    'a key under a value %i long is the same tree as a note opened with it',
    (length) => {
      const body = `title: x\nd: ${'y'.repeat(length)}\n`
      const state = typedAlong(`---\n${body}---\n\nw\n`, 4 + body.length - 1, '\nk: v')
      expect(top(state).split(' ')[0]).toMatch(/^FrontMatter/)
    },
  )

  test('a key typed anywhere in the block leaves it a block at every keystroke', () => {
    const doc = '---\ntitle: x\nother: y\n---\n\n# Heading\n\nwords\n'
    let state = EditorState.create({ doc, extensions: [language] })
    let from = doc.indexOf('other')
    for (const one of 'status: open\n') {
      state = state.update({ changes: { from, insert: one }, userEvent: 'input.type' }).state
      from += 1
      expect(top(state)).toBe(fresh(state.doc.toString()))
      expect(top(state).split(' ')[0]).toMatch(/^FrontMatter/)
    }
  })

  test('where a keystroke does turn a rule into a block or back, the trees agree', () => {
    const tail = `\n\n# Heading\n\n${'words words\n'.repeat(40)}`
    typedAlong(`---\n\n---${tail}`, 4, 'prose: x\n\nmore: y')
    typedAlong(`---\nprose words\n---${tail}`, 4 + 11, ': ')
    typedAlong(`---\ntitle: x\n${tail}`, 13, '---\n')
    typedAlong(`---\ntitle: x\n\nsta\n---${tail}`, 17, ': done')
    typedAlong(`---\ntitle: x\n---${tail}`, 12, '\n\nprose')
  })

  test('a block typed from nothing is the same tree at every keystroke', () => {
    typedAlong(`\n# Heading\n\n${'words\n'.repeat(60)}`, 0, '---\ntitle: x\nb: 1\n---\n')
  })
})

describe('a fence, as every parser of a note reads it', () => {
  test.each(fenceTable as [string, string, string[]][])('%j', (note, shape) => {
    const code = new Set<number>()
    const text = note.replaceAll('\r\n', '\n')
    const lineOf = (at: number) => text.slice(0, at).split('\n').length - 1
    nibMarkdownParser.parse(text).iterate({
      enter(node) {
        if (node.name !== 'FencedCode') return
        for (let at = lineOf(node.from); at <= lineOf(node.to); at++) code.add(at)
      },
    })
    const said = text.split('\n').map((_, at) => (code.has(at) ? 'c' : 'w'))
    expect(said.join('')).toBe(shape.replaceAll('o', 'c'))
  })
})

describe('highlight', () => {
  test('parses ==marked==', () => {
    expect(names('a ==marked== b')).toContain('Highlight')
    expect(names('a ==marked== b').filter((n) => n === 'HighlightMark')).toHaveLength(2)
  })

  test('leaves a lone equals alone', () => {
    expect(names('a = b')).not.toContain('Highlight')
  })
})

describe('inline math', () => {
  test('parses $x^2$', () => {
    expect(names('see $x^2$ here')).toContain('InlineMath')
  })

  test('ignores prices with spaces', () => {
    expect(names('costs $5 and $9 total')).not.toContain('InlineMath')
  })

  test('ignores a dollar at end of line', () => {
    expect(names('a $ b')).not.toContain('InlineMath')
  })

  test('ignores a range of prices, whose second dollar is before a digit', () => {
    expect(names('from $5-$10 a head')).not.toContain('InlineMath')
    expect(names('$x$1 is not')).not.toContain('InlineMath')
    expect(names('$x$ 1 is')).toContain('InlineMath')
  })
})

describe('block math', () => {
  test('parses a $$ fence', () => {
    expect(tree('$$\nE = mc^2\n$$\n')).toMatchInlineSnapshot(`
      "Document "$$\\nE = mc^2\\n$$\\n"
        BlockMath "$$\\nE = mc^2\\n$$"
          MathMark "$$"
          MathMark "$$""
    `)
  })

  test('parses a whole line of $$…$$', () => {
    expect(tree('$$E = mc^2$$\n')).toMatchInlineSnapshot(`
      "Document "$$E = mc^2$$\\n"
        BlockMath "$$E = mc^2$$"
          MathMark "$$"
          MathMark "$$""
    `)
  })

  test('leaves $$ part way along a line alone', () => {
    expect(names('Costs $$5 and $$6 in total.')).not.toContain('BlockMath')
    expect(names('The sum $$E = mc^2$$ sits here.')).not.toContain('BlockMath')
  })

  test('does not read an empty pair as a formula', () => {
    expect(names('$$$$')).not.toContain('BlockMath')
  })

  test('ends the paragraph above it, in both shapes', () => {
    expect(names('Text above\n$$x + y$$\nText below\n')).toContain('BlockMath')
    expect(names('Text above\n$$\nx + y\n$$\nText below\n')).toContain('BlockMath')
  })

  test('which is what the two constructs either side of it already did', () => {
    expect(names('Text above\n```js\nlet x = 1\n```\nText below\n')).toContain('FencedCode')
    expect(names('Text above\n# A heading\nText below\n')).toContain('ATXHeading1')
  })

  test('and the paragraph above it is still a paragraph', () => {
    expect(tree('Text above\n$$x + y$$\n')).toMatchInlineSnapshot(`
      "Document "Text above\\n$$x + y$$\\n"
        Paragraph "Text above"
        BlockMath "$$x + y$$"
          MathMark "$$"
          MathMark "$$""
    `)
  })

  test('but prose about money is left where it is', () => {
    for (const doc of [
      'I paid\nCosts $$5 and $$6 in total.\n',
      'I paid\nThe sum $$E = mc^2$$ sits here.\n',
      'I paid\n$$$$\n',
    ]) {
      expect(names(doc), doc).not.toContain('BlockMath')
    }
  })
})

describe('footnotes', () => {
  test('parses a reference', () => {
    expect(names('text[^1] more')).toContain('FootnoteRef')
  })

  test('parses a definition', () => {
    expect(names('[^1]: the note')).toContain('FootnoteDef')
  })

  test('does not swallow ordinary links', () => {
    expect(names('[label](url)')).not.toContain('FootnoteRef')
  })
})

describe('front matter', () => {
  test('parses YAML at the top of the document', () => {
    expect(tree('---\ntitle: Hi\n---\n\nbody')).toMatchInlineSnapshot(`
      "Document "---\\ntitle: Hi\\n---\\n\\nbody"
        FrontMatter "---\\ntitle: Hi\\n---"
          FrontMatterMark "---"
          FrontMatterMark "---"
        Paragraph "body""
    `)
  })

  test('leaves a leading horizontal rule alone', () => {
    expect(names('---\n\njust a rule')).not.toContain('FrontMatter')
  })

  test('ignores YAML that is not at the top', () => {
    expect(names('intro\n\n---\ntitle: Hi\n---\n')).not.toContain('FrontMatter')
  })
})

describe('fenced code', () => {
  test('parses a closed fence with its marks, info and text', () => {
    expect(tree('```js\nlet x\n```\n')).toBe(
      [
        'Document "```js\\nlet x\\n```\\n"',
        '  FencedCode "```js\\nlet x\\n```"',
        '    CodeMark "```"',
        '    CodeInfo "js"',
        '    CodeText "let x"',
        '    CodeMark "```"',
      ].join('\n'),
    )
  })

  test('leaves an unclosed fence as a paragraph and the rest of the file alone', () => {
    const found = names('```\n# Title\n\nsome *emphasis* here')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ATXHeading1')
    expect(found).toContain('Emphasis')
    expect(tree('```\n# Title')).toBe(
      [
        'Document "```\\n# Title"',
        '  Paragraph "```"',
        '  ATXHeading1 "# Title"',
        '    HeaderMark "#"',
      ].join('\n'),
    )
  })

  test('many fences that never close are read in time that grows with their number', () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, i) => `${'~'.repeat(3 + (i % 7))}a\n`).join('')
    expect(growth((count) => nibMarkdownParser.parse(lines(count)), 2_000)).toBeLessThan(
      GROWS_AT_MOST,
    )
  }, 60_000)

  test('a fence after ones that never close still closes, by its own marks', () => {
    const found = names(`~~~a\n~~~~b\n\`\`\`\ncode\n\`\`\`\n~~~ c\n> ~~~\n> x\n> ~~~\n`)
    expect(found.filter((one) => one === 'FencedCode')).toHaveLength(2)
    expect(tree('~~~a\n\n~~~~\nx\n~~~~\n')).toContain('FencedCode "~~~a\\n\\n~~~~"')
  })

  test('leaves a fence on the last line as a paragraph', () => {
    expect(tree('# Title\n\n```')).toBe(
      [
        'Document "# Title\\n\\n```"',
        '  ATXHeading1 "# Title"',
        '    HeaderMark "#"',
        '  Paragraph "```"',
      ].join('\n'),
    )
  })

  test('still cuts a paragraph short, so the fence line stands on its own', () => {
    expect(tree('text\n```')).toBe(
      ['Document "text\\n```"', '  Paragraph "text"', '  Paragraph "```"'].join('\n'),
    )
  })

  test('becomes a fence the moment the third backtick of the closer lands', () => {
    expect(names('```js\ncode\n`')).not.toContain('FencedCode')
    expect(names('```js\ncode\n``')).not.toContain('FencedCode')
    expect(names('```js\ncode\n```')).toContain('FencedCode')
  })

  test('closes tildes with tildes, and backticks with backticks', () => {
    expect(names('~~~\ncode\n~~~')).toContain('FencedCode')
    expect(names('~~~\ncode\n```')).not.toContain('FencedCode')
    expect(names('```\ncode\n~~~')).not.toContain('FencedCode')
  })

  test('needs a closer at least as long as the opener', () => {
    expect(names('````\ncode\n```')).not.toContain('FencedCode')
    expect(tree('````\ncode\n```\n````')).toBe(
      [
        'Document "````\\ncode\\n```\\n````"',
        '  FencedCode "````\\ncode\\n```\\n````"',
        '    CodeMark "````"',
        '    CodeText "code\\n```"',
        '    CodeMark "````"',
      ].join('\n'),
    )
  })

  test('keeps the info string, but not one with a backtick in it', () => {
    expect(tree('```js extra \ncode\n```')).toContain('CodeInfo "js extra"')
    expect(names('```js`\ncode\n```')).not.toContain('FencedCode')
    expect(tree('~~~a`b\ncode\n~~~')).toContain('CodeInfo "a`b"')
  })

  test('allows up to three spaces of indent on either fence', () => {
    expect(names('   ```\ncode\n   ```')).toContain('FencedCode')
    expect(names('```\ncode\n    ```')).not.toContain('FencedCode')
  })

  test('leaves indented code alone', () => {
    expect(names('    code')).toContain('CodeBlock')
    expect(names('    ```')).toEqual(['Document', 'CodeBlock', 'CodeText'])
  })

  test('closes inside a list item', () => {
    expect(tree('- ```\n  code\n  ```')).toBe(
      [
        'Document "- ```\\n  code\\n  ```"',
        '  BulletList "- ```\\n  code\\n  ```"',
        '    ListItem "- ```\\n  code\\n  ```"',
        '      ListMark "-"',
        '      FencedCode "```\\n  code\\n  ```"',
        '        CodeMark "```"',
        '        CodeText "code"',
        '        CodeMark "```"',
      ].join('\n'),
    )
  })

  test('does not let a list item close a fence for it', () => {
    const found = names('- ```\n  code\n\nafter')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ListItem')
    expect(found.filter((name) => name === 'Paragraph')).toHaveLength(2)
  })

  test('ignores a closer outside the list item', () => {
    expect(names('- ```\n  code\n\n```')).not.toContain('FencedCode')
  })

  test('closes inside a blockquote', () => {
    expect(tree('> ```\n> code\n> ```')).toBe(
      [
        'Document "> ```\\n> code\\n> ```"',
        '  Blockquote "> ```\\n> code\\n> ```"',
        '    QuoteMark ">"',
        '    FencedCode "```\\n> code\\n> ```"',
        '      CodeMark "```"',
        '      QuoteMark ">"',
        '      CodeText "code"',
        '      QuoteMark ">"',
        '      CodeMark "```"',
      ].join('\n'),
    )
  })

  test('does not let a blockquote close a fence for it', () => {
    const found = names('> ```\n> code\n\nafter')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('Blockquote')
    expect(found.filter((name) => name === 'Paragraph')).toHaveLength(2)
  })

  test('is what Enter after an opening fence produces', () => {
    expect(names('```\n\n```')).toContain('FencedCode')
  })
})

describe('fenced code while editing', () => {
  const padding =
    '# Heading\n\nA paragraph of prose, long enough for the parse to keep it around.\n\n'.repeat(2)

  function edited(doc: string, from: number, to: number, insert: string): string[] {
    const state = stateFor(doc)
    syntaxTree(state)
    return namesOf(parsed(state.update({ changes: { from, to, insert } }).state))
  }

  function typed(doc: string, inserts: string[]): string[] {
    let state = stateFor(doc)
    for (const insert of inserts) {
      syntaxTree(state)
      state = parsed(state.update({ changes: { from: state.doc.length, insert } }).state)
    }
    syntaxTree(state)
    return namesOf(state)
  }

  test('becomes a fence once a closer is typed well below it', () => {
    const doc = '```js\n\n' + padding
    const found = edited(doc, doc.length, doc.length, '```')
    expect(found).toContain('FencedCode')
    expect(found).not.toContain('ATXHeading1')
  })

  test('goes back to a paragraph once the closer is removed', () => {
    const doc = '```js\n\n' + padding + '```'
    const found = edited(doc, doc.length - 3, doc.length, '')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ATXHeading1')
  })

  test('becomes a fence once the line ending its list item is removed', () => {
    const item = '- ```\n  ' + 'a'.repeat(200) + '\n'
    const doc = item + '\nx\n  ```'
    expect(names(doc)).not.toContain('FencedCode')
    expect(edited(doc, item.length + 1, item.length + 3, '')).toContain('FencedCode')
  })

  test('becomes a fence on the third backtick of a closer typed key by key', () => {
    const doc = '```js\n\n' + padding
    expect(typed(doc, ['`', '`'])).not.toContain('FencedCode')
    const found = typed(doc, ['`', '`', '`'])
    expect(found).toContain('FencedCode')
    expect(found).not.toContain('ATXHeading1')
  })

  test('stays a paragraph through prose typed below it', () => {
    const doc = '```js\n\n' + padding
    const found = typed(doc, ['more', ' prose', ' still', ' no', ' closer'])
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ATXHeading1')
  })

  test('a closer typed long after the last edit still closes it', () => {
    const doc = '```js\n\n' + padding
    const found = typed(doc, ['one\n\n', 'two\n\n', 'three\n\n', '```'])
    expect(found).toContain('FencedCode')
  })

  test('a fence inside a list item closes after edits elsewhere', () => {
    const doc = '- ~~~\n  ' + 'a'.repeat(200) + '\n'
    expect(typed(doc, ['\ntext\n\n'])).not.toContain('FencedCode')
    expect(typed(doc, ['  ~~~\n'])).toContain('FencedCode')
  })

  test('two unclosed fences, and the first one closes on its own', () => {
    const doc = '```js\n\n' + padding + '~~~\n\ntail\n'
    const found = typed(doc, ['```\n'])
    expect(found).toContain('FencedCode')
    expect(found.filter((name) => name === 'FencedCode')).toHaveLength(1)
  })
})

describe('a long paragraph', () => {
  test('parses in time that grows with its length', () => {
    const parser = markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }).language
      .parser
    const log = (lines: number) => {
      let doc = ''
      for (let line = 0; line < lines; line++) {
        doc += `2026-10-19 12:00:00 [INFO] request ${line} url=https://example.com/${line}\n`
      }
      return doc
    }
    const found = { Link: 0, URL: 0 }
    const read = (lines: number) => {
      found.Link = found.URL = 0
      parser.parse(log(lines)).iterate({
        enter: (node) => {
          if (node.name === 'Link' || node.name === 'URL') found[node.name]++
        },
      })
    }
    expect(growth(read, 5_000)).toBeLessThan(GROWS_AT_MOST)
    expect(found).toEqual({ Link: 20_000, URL: 20_000 })
  }, 60_000)

  test('full of dollar signs that close nothing parses in time that grows with its length', () => {
    const parser = markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }).language
      .parser
    let maths = 0
    const read = (count: number) => {
      maths = 0
      parser.parse(`${'$5 and '.repeat(count)}or 1$2\n\n$x$\n`).iterate({
        enter: (node) => {
          if (node.name === 'InlineMath') maths++
        },
      })
    }
    expect(growth(read, 2_000)).toBeLessThan(GROWS_AT_MOST)
    expect(maths).toBe(1)
  }, 60_000)

  test('a long run of spaces, or of brackets after an address, parses in time that grows with its length', () => {
    const runs = [
      (length: number) => `k${' '.repeat(length)}:\n`,
      (length: number) => `https://a.b/${')'.repeat(length)}\n`,
    ]
    for (const run of runs) {
      expect(growth((length) => nibMarkdownParser.parse(run(length)), 16_000)).toBeLessThan(
        GROWS_AT_MOST,
      )
    }
  }, 60_000)

  test('a line of list or quote marks thousands deep parses in time that grows with its length', () => {
    const parsed = (unit: string) => (length: number) =>
      nibMarkdownParser.parse(`${unit.repeat(Math.ceil(length / unit.length))}x\n`)
    for (const unit of ['- ', '* ', '1. ', '> ', '> - ']) {
      expect(growth(parsed(unit), 16_000), unit).toBeLessThan(GROWS_AT_MOST)
    }
  }, 30_000)

  test('reads lists and quotes 100 deep, as the page is drawn', () => {
    const items = (doc: string) => tree(doc).match(/^\s*ListItem /gm)?.length ?? 0
    expect(items(`${'- '.repeat(150)}x\n`)).toBe(100)
    expect(items(`${'- '.repeat(99)}x\n`)).toBe(99)
    expect(tree(`${'> '.repeat(150)}x\n`).match(/^\s*Blockquote /gm)).toHaveLength(100)
  })

  test('still reads a hard break, and the brackets an address keeps', () => {
    expect(tree('a   \nb')).toContain('HardBreak')
    expect(tree('a \nb')).not.toContain('HardBreak')
    expect(tree('a    b  \nc')).toContain('HardBreak "  \\n"')
    expect(tree('see https://a.b/(x)) and')).toContain('URL "https://a.b/(x)"')
    expect(tree('see https://a.b/x).')).toContain('URL "https://a.b/x"')
  })

  test('repeating what opens a link or emphasis parses in time that grows with its length', () => {
    const parser = markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }).language
      .parser
    const parsed = (unit: string) => (length: number) =>
      parser.parse(`${unit.repeat(Math.ceil(length / unit.length))}\n`)
    for (const unit of ['[a](', '![a](', '[a](x (', '*[a', '_[a', '*a_ [b ', '==a ', '%%a ']) {
      expect(growth(parsed(unit), 16_000), unit).toBeLessThan(GROWS_AT_MOST)
    }
  }, 60_000)

  test('repeating what closes a link nothing opened parses in time that grows with its length', () => {
    const parsed = (unit: string) => (length: number) =>
      nibMarkdownParser.parse(`${unit.repeat(Math.ceil(length / unit.length))}\n`)
    for (const unit of [']*', '_]', '*]', ']$', '`]', 'a] ', '[a] ]*']) {
      expect(growth(parsed(unit), 32_000), unit).toBeLessThan(GROWS_AT_MOST)
    }
  }, 120_000)

  test('reads a link and emphasis that close as before', () => {
    expect(
      tree('[a](b(c)) [d](e (f)) *g [h](i)* **j**').match(/(URL|LinkTitle|\w*Emphasis) ".*"/g),
    ).toEqual([
      'URL "b(c)"',
      'URL "e"',
      'LinkTitle "(f)"',
      'Emphasis "*g [h](i)*"',
      'URL "i"',
      'StrongEmphasis "**j**"',
    ])
    expect(tree('[a](b (c(d)))')).not.toContain('LinkTitle')
    expect(tree(`[a](${'('.repeat(33)}b${')'.repeat(33)})`)).not.toContain('URL')
    expect(tree(`[a](${'('.repeat(32)}b${')'.repeat(32)})`)).toContain('URL')
  })

  test('still ends an address at the bracket of the link it is in', () => {
    expect(tree('[a [b](c) www.example.com] and [see www.example.com]').match(/URL ".*"/g)).toEqual(
      ['URL "c"', 'URL "www.example.com"', 'URL "www.example.com"'],
    )
  })
})
