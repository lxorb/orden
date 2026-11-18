import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { tailOf } from './tail'
import { parsed } from '../test/parsed'

function state(doc: string) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function tail(doc: string) {
  return tailOf(state(doc))
}

describe('a note that ends in a block', () => {
  test.each([
    [
      'words\n\n```ts\nlet x = 1\n```',
      { at: 'words\n\n```ts\nlet x = 1\n```'.length, insert: '\n' },
    ],
    ['words\n\n    indented', { at: 'words\n\n    indented'.length, insert: '\n' }],
    [
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      { at: '| a | b |\n| --- | --- |\n| 1 | 2 |'.length, insert: '\n' },
    ],
    ['words\n\n$$\nx = 1\n$$', { at: 'words\n\n$$\nx = 1\n$$'.length, insert: '\n' }],
  ])('%j', (input, wanted) => expect(tail(input)).toEqual(wanted))

  test('a picture on a line of its own gets a blank line as well', () => {
    const doc = 'words\n\n![a](b.png)'
    expect(tail(doc)).toEqual({ at: doc.length, insert: '\n\n' })
  })

  test('an embedded picture counts as one', () => {
    const doc = 'words\n\n![[picture.png]]'
    expect(tail(doc)).toEqual({ at: doc.length, insert: '\n\n' })
  })
})

describe('a note the caret can already get out of', () => {
  test.each([
    ['words\n\nmore words'],
    ['# Head'],
    ['```ts\nlet x = 1\n```\n'],
    ['| a | b |\n| --- | --- |\n| 1 | 2 |\n\n'],
    [''],
    ['see ![a](b.png) there'],
    ['```\ncode\n```\n\nafter'],
  ])('%j', (input) => expect(tail(input)).toBeNull())
})
