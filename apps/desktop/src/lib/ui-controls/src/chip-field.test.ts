import { describe, expect, test } from 'vitest'
import { carried, chipEndingAt, chosen, piecesOf, suggestions, tokenAt } from './chip-field'

const SIGNS = ['#', '@', '%']
test('the line as runs words and chips, in order, each where it was typed', () => {
  const text = 'Call mum tomorrow p1'
  expect(
    piecesOf(text, [
      { kind: 'priority', from: 18, to: 20 },
      { kind: 'when', from: 9, to: 17 },
    ]),
  ).toEqual([
    { text: 'Call mum ', from: 0 },
    { text: 'tomorrow', chip: 'when', from: 9 },
    { text: ' ', from: 17 },
    { text: 'p1', chip: 'priority', from: 18 },
  ])
})
describe('a span turned back into words', () => {
  const span = { from: 9, to: 17 }
  test('moves with the words when something is typed before it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Now call mum tomorrow')).toEqual([{ from: 13, to: 21 }])
  })
  test('stays when something is typed after it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Call mum tomorrow p1')).toEqual([span])
  })
  test('goes when the edit reaches into it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Call mum tomorow')).toEqual([])
  })
})
describe('a word that asks for a suggestion', () => {
  test('is one that starts with a sign the field was given', () => {
    expect(tokenAt('Call mum #fa', 12, SIGNS)).toEqual({ sign: '#', query: 'fa', from: 9, to: 12 })
    expect(tokenAt('Buy @', 5, SIGNS)).toEqual({ sign: '@', query: '', from: 4, to: 5 })
    expect(tokenAt('Fix tap >Ho', 11, SIGNS)).toBeNull()
    expect(tokenAt('Fix tap >Ho', 11, ['>'])).toEqual({ sign: '>', query: 'Ho', from: 8, to: 11 })
    expect(tokenAt('Call mum #fa', 12, ['@'])).toBeNull()
    expect(tokenAt('Call mum', 8, SIGNS)).toBeNull()
    expect(tokenAt('#family call', 3, SIGNS)).toBeNull()
  })
  test('is offered what starts with it first, then what holds it', () => {
    expect(suggestions('fa', ['family', 'farm', 'breakfast', 'work'])).toEqual(['family', 'farm', 'breakfast'])
    expect(suggestions('', ['a', 'b'])).toEqual(['a', 'b'])
    expect(suggestions('family', ['family'])).toEqual([])
  })
  test('is replaced by the one chosen, the caret after it', () => {
    const token = tokenAt('Call mum #fa tomorrow', 12, SIGNS)
    if (!token) throw new Error('no token')
    expect(chosen('Call mum #fa tomorrow', token, 'family')).toEqual({
      text: 'Call mum #family tomorrow',
      caret: 17,
    })
  })
})
test('the chip a caret sits at the end of', () => {
  const chips = [{ kind: 'when', from: 9, to: 17 }]
  expect(chipEndingAt(chips, 17)).toEqual(chips[0])
  expect(chipEndingAt(chips, 16)).toBeNull()
})
