import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, test } from 'vitest'
import { fenceCaption, fenceCode, fenceCodeAt, fenceLanguage } from './fence'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function fence(doc: string): { state: EditorState; node: SyntaxNode } {
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
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
  test.each([
    ['```js\nlet a = 1\n```', { language: 'js', caption: '' }],
    ['```ts src/main.ts\nlet a = 1\n```', { language: 'ts', caption: 'src/main.ts' }],
    ['```js title="setup.js"\nlet a = 1\n```', { language: 'js', caption: 'setup.js' }],
    ['```\nplain\n```', { language: '', caption: '' }],
  ])('%j', (input, wanted) => expect(said(input)).toEqual(wanted))

  test('the code is the code either way', () => {
    const { state, node } = fence('```ts src/main.ts\nlet a = 1\nlet b = 2\n```')
    expect(fenceCode(state, node)).toBe('let a = 1\nlet b = 2')
  })
})

describe('the code at a place in the document', () => {
  const doc = '# One\n\n```ts\nlet a = 1\nlet b = 2\n```\n\nWords.\n'
  const at = doc.indexOf('```ts')

  test('is the block that place is in, wherever in it the place sits', () => {
    const { state } = fence(doc)

    expect(fenceCodeAt(state, at)).toBe('let a = 1\nlet b = 2')
    expect(fenceCodeAt(state, doc.indexOf('let b'))).toBe('let a = 1\nlet b = 2')
  })

  test('is nothing where the place is in no block at all', () => {
    const { state } = fence(doc)
    expect(fenceCodeAt(state, doc.indexOf('Words.'))).toBe('')
  })

  test('and is what the document says now, not what it said when it was drawn', () => {
    const { state } = fence(doc)
    const typed = parsed(
      state.update({
        changes: { from: doc.indexOf('= 1') + 2, to: doc.indexOf('= 1') + 3, insert: '7' },
      }).state,
    )

    expect(fenceCodeAt(typed, at)).toBe('let a = 7\nlet b = 2')
  })
})
