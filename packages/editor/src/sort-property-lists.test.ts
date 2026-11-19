import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { readProperties } from '@orden/markdown/properties'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { reverseLines, sortLines } from './lines'
import { ordenMarkdownExtensions } from './markdown/extensions'

function ran(command: StateCommand, doc: string, at: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf(at)),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

function valuesOf(doc: string): Record<string, string[] | string> | null {
  const rows = readProperties(doc)
  if (!rows) return null
  return Object.fromEntries(rows.map((row) => [row.key, row.kind === 'list' ? [...row.items].sort() : row.value]))
}

describe('edit75 sorting front matter that holds block lists', () => {
  test('sort lines keeps a list property readable', () => {
    const doc = '---\ntitle: x\ntags:\n  - b\n  - a\n---\n\npara'
    expect(valuesOf(ran(sortLines, doc, 'title'))).toEqual({ title: 'x', tags: ['a', 'b'] })
  })

  test('sort lines keeps each list under its own key', () => {
    const doc = '---\ntags:\n  - work\n  - home\naliases:\n  - Plan\n---\n\npara'
    expect(valuesOf(ran(sortLines, doc, 'home'))).toEqual({
      tags: ['home', 'work'],
      aliases: ['Plan'],
    })
  })

  test('reverse lines keeps a list property readable', () => {
    const doc = '---\ntitle: x\ntags:\n  - b\n---\n\npara'
    expect(valuesOf(ran(reverseLines, doc, 'title'))).toEqual({ title: 'x', tags: ['b'] })
  })
})

test('sort lines on a key moves each key with the lines under it', () => {
  const doc = '---\ntitle: x\ntags:\n  - b\n  - a\n---\n\npara'
  expect(ran(sortLines, doc, 'title')).toBe('---\ntags:\n  - b\n  - a\ntitle: x\n---\n\npara')
})

test('sort lines on a list item sorts only the items of that key', () => {
  const doc = '---\ntags:\n  - work\n  - home\naliases:\n  - Plan\n---\n\npara'
  expect(ran(sortLines, doc, 'home')).toBe('---\ntags:\n  - home\n  - work\naliases:\n  - Plan\n---\n\npara')
})
