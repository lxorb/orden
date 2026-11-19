import { describe, expect, test } from 'vitest'
import { headingAbove, sentWords } from '../src/sent-words'
import { levelWord } from '../src/level-words'
import { recordVoice } from '../src/voice'

describe('a note sent to a chat', () => {
  test('is its link alone, or the quoted lines above a link to the heading they sit under', () => {
    expect(sentWords('Plan')).toBe('[[Plan]] ')
    expect(sentWords('Plan', { text: 'one\n\ntwo', heading: 'Goals' })).toBe('> one\n>\n> two\n\n[[Plan#Goals]] ')
  })

  test('finds the nearest heading above where the quote starts', () => {
    const text = '# Plan\n\n## Goals\nship it\n'
    expect(headingAbove(text, text.indexOf('ship'))).toBe('Goals')
    expect(headingAbove('no heading here', 5)).toBeNull()
  })
})

describe('how urgent a message is', () => {
  test('reads as a word for every level', () => {
    expect(['urgent', 'important', 'if-time', 'unimportant'].map((one) => levelWord(one as never))).toEqual([
      'Urgent',
      'Important',
      'If time',
      'Unimportant',
    ])
  })
})

describe('the voice', () => {
  test('is refused with a reason while no module has bound the voice port', async () => {
    await expect(recordVoice()).rejects.toThrow(/voice/)
  })
})
