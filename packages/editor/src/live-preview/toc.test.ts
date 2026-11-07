import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { headings, TocWidget } from './toc'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function state(doc: string) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

describe('reading the headings of a document', () => {
  test('finds them in order, with their levels', () => {
    const found = headings(state('# One\n\ntext\n\n### Three\n\n## Two\n'))
    expect(found.map((one) => [one.level, one.text])).toEqual([
      [1, 'One'],
      [3, 'Three'],
      [2, 'Two'],
    ])
  })

  test('strips the marks a heading is written with', () => {
    expect(headings(state('##   Spaced   ##\n'))[0]?.text).toBe('Spaced')
  })

  test('reads no heading from a line with = or - under it', () => {
    expect(headings(state('Title\n=====\n\nSub\n---\n\nItem\n- one\n'))).toEqual([])
  })

  test('says where each one starts', () => {
    const doc = 'intro\n\n# One\n'
    expect(headings(state(doc))[0]?.from).toBe(doc.indexOf('# One'))
  })

  test('finds nothing in a document with no headings', () => {
    expect(headings(state('just text\n'))).toEqual([])
  })
})

describe('a table of contents', () => {
  test('is the same when nothing about the headings changed', () => {
    const entries = headings(state('# One\n\n## Two\n'))
    expect(new TocWidget(entries).eq(new TocWidget([...entries]))).toBe(true)
  })

  test('is different when a heading moved', () => {
    const before = headings(state('# One\n\n## Two\n'))
    const after = headings(state('a new line\n\n# One\n\n## Two\n'))

    expect(after.map((one) => one.text)).toEqual(before.map((one) => one.text))
    expect(new TocWidget(before).eq(new TocWidget(after))).toBe(false)
  })

  test('is different when a heading was renamed, added or promoted', () => {
    const one = headings(state('# One\n\n## Two\n'))
    expect(new TocWidget(one).eq(new TocWidget(headings(state('# One\n\n## Owt\n'))))).toBe(false)
    expect(new TocWidget(one).eq(new TocWidget(headings(state('# One\n\n### Two\n'))))).toBe(false)
    expect(new TocWidget(one).eq(new TocWidget(headings(state('# One\n'))))).toBe(false)
  })
})
