import { EditorState } from '@orden/editor'
import { describe, expect, test } from 'vitest'
import { parseQuery } from '@orden/scan/search/query'
import { asWritten, selectedWords } from './seed'

const selecting = (doc: string, from: number, to: number) =>
  EditorState.create({ doc, selection: { anchor: from, head: to } })

describe('the words a search of the space starts from', () => {
  test('are the few selected on one line', () => {
    expect(selectedWords(selecting('the quick brown fox', 4, 15))).toBe('quick brown')
  })

  test('are nothing for a bare caret', () => {
    expect(selectedWords(selecting('the quick brown fox', 4, 4))).toBeNull()
  })

  test('are nothing for a passage over several lines, or a long one', () => {
    expect(selectedWords(selecting('one\ntwo', 0, 7))).toBeNull()
    expect(selectedWords(selecting('x'.repeat(300), 0, 300))).toBeNull()
  })
})

describe('the search a selection asks for', () => {
  const word = (text: string) => ({ kind: 'text', text, fold: true })

  test('is the words as written, never the operators they look like', () => {
    expect(parseQuery(asWritten('-webkit-box'))).toEqual(word('-webkit-box'))
    expect(parseQuery(asWritten('tag:x'))).toEqual(word('tag:x'))
    expect(parseQuery(asWritten('say "hi" \\o/'))).toEqual({
      kind: 'all',
      of: [word('say'), word('"hi"'), word('\\o/')],
    })
    expect(parseQuery(asWritten('this OR that'))).toEqual({
      kind: 'all',
      of: [word('this'), word('OR'), word('that')],
    })
  })

  test('and leaves plain words as they were', () => {
    expect(asWritten('quick brown')).toBe('quick brown')
  })
})
