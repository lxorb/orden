import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, test } from 'vitest'
import { fenceCaption, fenceCode, fenceLanguage } from './fence'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

/** The first fenced block of a document, and the state it is in. */
function fence(doc: string): { state: EditorState; node: SyntaxNode } {
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )

  const fences: SyntaxNode[] = []
  syntaxTree(state).iterate({
    enter: (found) => {
      if (found.name === 'FencedCode') fences.push(found.node)
    },
  })

  const node = fences[0]
  if (!node) throw new Error('no fence in that document')
  return { state, node }
}

const said = (doc: string) => {
  const { state, node } = fence(doc)
  return { language: fenceLanguage(state, node), caption: fenceCaption(state, node) }
}

describe('what a fence says', () => {
  test('a language on its own', () => {
    expect(said('```js\nlet a = 1\n```')).toEqual({ language: 'js', caption: '' })
  })

  test('the words after the language are what the block is', () => {
    expect(said('```ts src/main.ts\nlet a = 1\n```')).toEqual({
      language: 'ts',
      caption: 'src/main.ts',
    })
  })

  test('a language is one word however the caption is written', () => {
    // What the header, the run button, the highlighter and every parser lookup
    // read: a fence that says more than its language is still that language.
    expect(said('```js title="setup.js"\nlet a = 1\n```')).toEqual({
      language: 'js',
      caption: 'setup.js',
    })
  })

  test('a fence with no info string says nothing', () => {
    expect(said('```\nplain\n```')).toEqual({ language: '', caption: '' })
  })

  test('the code is the code either way', () => {
    const { state, node } = fence('```ts src/main.ts\nlet a = 1\nlet b = 2\n```')
    expect(fenceCode(state, node)).toBe('let a = 1\nlet b = 2')
  })
})
