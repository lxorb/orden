import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { readProperties } from '@orden/markdown/properties'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { reverseLines, sortLines } from './lines'
import { ordenMarkdownExtensions } from './markdown/extensions'

function ranOver(command: StateCommand, doc: string, from: string, to: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(doc.indexOf(from), doc.indexOf(to) + to.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

function valuesOf(doc: string): Record<string, string[] | string> | null {
  const rows = readProperties(doc)
  if (!rows) return null
  return Object.fromEntries(
    rows.map((row) => [row.key, row.kind === 'list' ? [...row.items].sort() : row.value]),
  )
}

describe('edit76 sorting picked front matter lines that hold block lists', () => {
  test('sort lines over every property keeps the list under its key', () => {
    const doc = '---\ntitle: x\ntags:\n  - b\n  - a\n---\n\npara'
    expect(valuesOf(ranOver(sortLines, doc, 'title', '- a'))).toEqual({
      title: 'x',
      tags: ['a', 'b'],
    })
  })

  test('sort lines over two keys keeps the list item under its own key', () => {
    const doc = '---\nz: 1\ntags:\n  - b\na: 2\n---\n\npara'
    expect(valuesOf(ranOver(sortLines, doc, 'z: 1', 'tags:'))).toEqual({
      z: '1',
      tags: ['b'],
      a: '2',
    })
  })

  test('reverse lines over every property keeps the list under its key', () => {
    const doc = '---\ntitle: x\ntags:\n  - b\n---\n\npara'
    expect(valuesOf(ranOver(reverseLines, doc, 'title', '- b'))).toEqual({
      title: 'x',
      tags: ['b'],
    })
  })
})

test('a selection from a list item down to the next key moves whole keys', () => {
  const doc = '---\ntags:\n  - b\n  - a\nalpha: 1\n---\n\npara'
  expect(ranOver(sortLines, doc, '- a', 'alpha')).toBe(
    '---\nalpha: 1\ntags:\n  - b\n  - a\n---\n\npara',
  )
})
