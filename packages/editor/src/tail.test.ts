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
  test('a code fence gets one line', () => {
    const doc = 'words\n\n```ts\nlet x = 1\n```'
    expect(tail(doc)).toEqual({ at: doc.length, insert: '\n' })
  })

  test('an indented code block gets one line', () => {
    const doc = 'words\n\n    indented'
    expect(tail(doc)).toEqual({ at: doc.length, insert: '\n' })
  })

  test('a table gets one line', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(tail(doc)).toEqual({ at: doc.length, insert: '\n' })
  })

  test('a formula gets one line', () => {
    const doc = 'words\n\n$$\nx = 1\n$$'
    expect(tail(doc)).toEqual({ at: doc.length, insert: '\n' })
  })

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
  test('ends in a paragraph', () => {
    expect(tail('words\n\nmore words')).toBeNull()
  })

  test('ends in a heading', () => {
    expect(tail('# Head')).toBeNull()
  })

  test('already ends in an empty line', () => {
    expect(tail('```ts\nlet x = 1\n```\n')).toBeNull()
    expect(tail('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n')).toBeNull()
  })

  test('is empty', () => {
    expect(tail('')).toBeNull()
  })

  test('ends in a picture with words beside it, which is a paragraph', () => {
    expect(tail('see ![a](b.png) there')).toBeNull()
  })

  test('ends in words under a fence', () => {
    expect(tail('```\ncode\n```\n\nafter')).toBeNull()
  })
})
