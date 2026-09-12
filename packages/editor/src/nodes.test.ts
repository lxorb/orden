import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { enclosing, enclosingNamed } from './nodes'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function state(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
}

/** Every node around a position, innermost first, by name. */
function around(doc: string, at: number, side: -1 | 1 = -1): string[] {
  const found = syntaxTree(state(doc)).resolveInner(at, side)
  return [...enclosing(found)].map((node) => node.name)
}

describe('the walk up from a position', () => {
  test('starts at the innermost node and ends at the document', () => {
    const doc = '- one\n- two `code` three\n'
    const names = around(doc, doc.indexOf('code') + 1)

    expect(names[0]).toBe('InlineCode')
    expect(names).toContain('ListItem')
    expect(names.at(-1)).toBe('Document')
  })

  test('crosses a language mount, so a token in a fence still finds its fence', () => {
    const doc = '```js\nlet a = 1\n```\n'
    expect(around(doc, doc.indexOf('let') + 1)).toContain('FencedCode')
  })

  /** The two loops that stopped at `node.parent` never looked at the last node of
   *  the chain. This is why that was invisible rather than wrong: the last node is
   *  the document, whatever the position is in, and no caller asks about it. Were
   *  a construct ever to be the outermost node, those two would have missed it -
   *  which is the reason they are on this walk now. */
  test('and the last node is always the document, whatever the position is in', () => {
    const docs = [
      '',
      'words\n',
      '| a | b |\n| - | - |\n| 1 | 2 |\n',
      '> quoted\n',
      '```js\nlet a = 1\n```\n',
      '$$\nx = 1\n$$\n',
      '# A heading\n',
    ]

    for (const doc of docs) {
      for (const at of [0, Math.floor(doc.length / 2), doc.length]) {
        expect(around(doc, at).at(-1), `${doc} at ${at}`).toBe('Document')
        expect(around(doc, at, 1).at(-1), `${doc} at ${at}`).toBe('Document')
      }
    }
  })
})

describe('the innermost node of a name', () => {
  test('is found by a set of names or by one name', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    const at = syntaxTree(state(doc)).resolveInner(doc.indexOf('1'), -1)

    expect(enclosingNamed(at, 'Table')?.name).toBe('Table')
    expect(enclosingNamed(at, new Set(['Table', 'Document']))?.name).toBe('Table')
    expect(enclosingNamed(at, 'Wikilink')).toBeNull()
  })

  test('and the document is a node like any other, since the walk reaches it', () => {
    const at = syntaxTree(state('words\n')).resolveInner(2, -1)
    expect(enclosingNamed(at, 'Document')?.name).toBe('Document')
  })
})
