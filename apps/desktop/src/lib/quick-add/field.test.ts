import { describe, expect, test } from 'vitest'
import { carried, chosen, pastedLines, piecesOf, suggestions, tokenAt, without } from './field'

/** The field's bookkeeping: the line cut into words and chips, the spans pressed back
 *  into words following an edit, and a chip taken out when a control picks its field. */

describe('the line as runs', () => {
  test('words and chips, in order, each where it was typed', () => {
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
})

describe('a span turned back into words', () => {
  const span = { from: 9, to: 17 }

  test('moves with the words when something is typed before it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Now call mum tomorrow')).toEqual([
      { from: 13, to: 21 },
    ])
  })

  test('stays when something is typed after it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Call mum tomorrow p1')).toEqual([span])
  })

  test('goes when the edit reaches into it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Call mum tomorow')).toEqual([])
  })
})

describe('a chip taken out', () => {
  test('closes the gap it leaves', () => {
    expect(without('Call mum tomorrow at noon', { from: 9, to: 17 })).toBe('Call mum at noon')
    expect(without('tomorrow call mum', { from: 0, to: 8 })).toBe('call mum')
  })
})

describe('a paste of several lines', () => {
  test('is a task a line, each without the mark it was copied with', () => {
    expect(
      pastedLines('- [ ] Milk\r\n* Bread tomorrow\n\n2. Eggs #shop\n   \n• Butter\nplain words'),
    ).toEqual(['Milk', 'Bread tomorrow', 'Eggs #shop', 'Butter', 'plain words'])
    expect(pastedLines('one line')).toEqual(['one line'])
  })
})

describe('a word that asks for a suggestion', () => {
  test('is a label after # @ %, a note after >, a heading after the note', () => {
    expect(tokenAt('Call mum #fa', 12)).toEqual({ sign: '#', query: 'fa', from: 9, to: 12 })
    expect(tokenAt('Buy @', 5)).toEqual({ sign: '@', query: '', from: 4, to: 5 })
    expect(tokenAt('Fix tap >Ho', 11)).toEqual({ sign: '>', query: 'Ho', from: 8, to: 11 })
    expect(tokenAt('Fix tap >Home/Ki', 16)).toEqual({ sign: '/', query: 'Ki', from: 13, to: 16 })
    expect(tokenAt('Call mum', 8)).toBeNull()
    expect(tokenAt('#family call', 3)).toBeNull()
  })

  test('is offered what starts with it first, then what holds it', () => {
    expect(suggestions('fa', ['family', 'farm', 'breakfast', 'work'])).toEqual([
      'family',
      'farm',
      'breakfast',
    ])
    expect(suggestions('', ['a', 'b'])).toEqual(['a', 'b'])
    expect(suggestions('family', ['family'])).toEqual([])
  })

  test('is replaced by the one chosen, the caret after it', () => {
    const token = tokenAt('Call mum #fa tomorrow', 12)
    if (!token) throw new Error('no token')
    expect(chosen('Call mum #fa tomorrow', token, 'family')).toEqual({
      text: 'Call mum #family tomorrow',
      caret: 17,
    })
  })
})
