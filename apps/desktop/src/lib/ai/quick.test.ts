import { describe, expect, test } from 'vitest'
import { carried, insertion } from './quick'

describe('where an answer goes into the note', () => {
  const put = (doc: string, at: number, answer: string) => {
    const { from, insert } = insertion(doc, at, answer)
    return doc.slice(0, from) + insert + doc.slice(from)
  }

  test('on lines of its own under the line it was asked from', () => {
    expect(put('one\ntwo\nthree', 1, 'answer')).toBe('one\n\nanswer\n\ntwo\nthree')
    expect(put('one\n\ntwo', 2, 'answer')).toBe('one\n\nanswer\n\ntwo')
  })

  test('at the end of a note with one blank line before it', () => {
    expect(put('one', 3, ' answer \n')).toBe('one\n\nanswer')
    expect(put('one\n', 4, 'answer')).toBe('one\n\nanswer')
    expect(put('one\n\n', 5, 'answer')).toBe('one\n\nanswer')
  })

  test('as the whole of an empty note', () => {
    expect(put('', 0, 'answer')).toBe('answer')
  })

  test('with the caret after it', () => {
    const doc = 'one\ntwo'
    const { from, insert, caret } = insertion(doc, 0, 'answer')
    expect((doc.slice(0, from) + insert).slice(0, caret).endsWith('answer')).toBe(true)
  })
})

describe('where it was asked from, once the note changed meanwhile', () => {
  test('stays put where the change came after it', () => {
    expect(carried('one\ntwo', 'one\ntwo and more', 3)).toBe(3)
  })

  test('moves along with what came in before it', () => {
    expect(carried('one\ntwo', 'zero\none\ntwo', 7)).toBe(12)
  })

  test('goes to the end of what changed where the change took its place', () => {
    expect(carried('one\ntwo\nthree', 'one\nTWO!\nthree', 5)).toBe(8)
  })
})
