import { describe, expect, test } from 'vitest'
import { commandIn, commandWords, DEFAULT_WORDS } from './commands'

/** The phrases a reader may change.
 *
 *  Every command answers to a phrase and every phrase can be typed over, in the
 *  reader's own language if they like. The grammar reads what they typed; nothing
 *  holds a second copy of the list. */

describe('the phrases a reader may change', () => {
  test('are offered with what the app answers to now', () => {
    const words = commandWords()

    expect(words.length).toBeGreaterThan(5)
    for (const one of words) {
      expect(one.id, JSON.stringify(one)).toBeTruthy()
      expect(one.label).toBeTruthy()
      // The phrase the app answers to, which is the field's own placeholder: an
      // empty field is that put back.
      expect(one.said).toBe(DEFAULT_WORDS[one.id])
    }
  })

  test('answer to their defaults with nothing changed', () => {
    expect(commandIn('next')).toEqual({ kind: 'next' })
    expect(commandIn('next', {})).toEqual({ kind: 'next' })
  })

  test('answer to what the reader typed instead', () => {
    const words = { next: 'vorwärts' }

    expect(commandIn('vorwärts', words)).toEqual({ kind: 'next' })
    // And not to the one they replaced: a phrase they rebound is theirs.
    expect(commandIn('next', words)).toBeNull()
  })

  test('take a phrase of several words, and the rest of the line after it', () => {
    const words = { question: 'frag mich' }

    expect(commandIn('frag mich was steht in der notiz', words)).toEqual({
      kind: 'question',
      asked: 'was steht in der notiz',
    })
  })

  test('are matched longest first, whatever they were rebound to', () => {
    // "zu" is a prefix of "zu der seite drei": the longer one has to win, or the
    // shorter one eats it and the number is lost.
    const words = { close: 'zu', page: 'zu der seite' }

    expect(commandIn('zu', words)).toEqual({ kind: 'close' })
    // A digit, because the words for the numbers are the recogniser's English ones
    // and rebinding a phrase does not translate those.
    expect(commandIn('zu der seite 3', words)).toEqual({ kind: 'page', number: 3 })
  })

  test('are folded the way anything heard is, so a recogniser’s habits do not matter', () => {
    const words = { next: 'Vorwärts!' }
    expect(commandIn('vorwärts', words)).toEqual({ kind: 'next' })
    expect(commandIn('Vorwärts.', words)).toEqual({ kind: 'next' })
  })

  test('keep the aliases the app has always had', () => {
    // "spaces view" and "switch space" are two ways of asking for one thing, and
    // rebinding the first must not take the second away.
    const words = { spaces: 'räume' }

    expect(commandIn('räume', words)).toEqual({ kind: 'spaces' })
    expect(commandIn('spaces view', words)).toEqual({ kind: 'spaces' })
  })

  test('ignore a phrase somebody emptied, rather than matching nothing', () => {
    const words = { next: '   ' }

    // Nothing answers to whitespace, and the command is simply not bound.
    expect(commandIn('next', words)).toBeNull()
    expect(commandIn('', words)).toBeNull()
    expect(commandIn('back', words)).toEqual({ kind: 'back' })
  })
})
