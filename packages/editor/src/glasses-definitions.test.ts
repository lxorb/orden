import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { markLines } from '../../glasses/src/mark'

const INNER = 576

describe('a definition list on the glasses', () => {
  const note = 'Intro\n\nApple\n: A red fruit\n: Round\nBanana\n: A yellow fruit\n\nend'
  const marked = markLines(note, { inner: INNER })
  const lineOf = (words: string) => marked.find((line) => line.text.includes(words))

  test('numbers each meaning by its own line', () => {
    expect([lineOf('A red fruit')?.at, lineOf('Round')?.at, lineOf('A yellow fruit')?.at]).toEqual([
      4, 5, 7,
    ])
  })

  test('numbers a later term by its own line', () => {
    expect(lineOf('Banana')?.at).toBe(6)
  })

  test('places a meaning where it is written', () => {
    expect(lineOf('A yellow fruit')?.from).toBe(note.indexOf(': A yellow fruit'))
  })
})
