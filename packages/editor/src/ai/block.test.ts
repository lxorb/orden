import { describe, expect, test } from 'vitest'
import {
  ANSWER_CLOSE,
  ANSWER_OPEN,
  answerParts,
  answerSpan,
  answerText,
  isAiLanguage,
  mentionsNote,
} from './block'

const lines = (note: string) => note.split('\n')

describe('the ai fence language', () => {
  test.each([
    ['ai', true],
    ['AI', true],
    [' ai ', true],
    ['aiml', false],
    ['', false],
  ])('%j', (input, wanted) => expect(isAiLanguage(input)).toEqual(wanted))
})

describe('a prompt asking for the note', () => {
  test.each([
    ['Summarise @note in three bullets', true],
    ['@NOTE please', true],
    ['Write a note about herons', false],
    ['mail me at me@notebook.ch', false],
  ])('%j', (input, wanted) => expect(mentionsNote(input)).toEqual(wanted))
})

describe('an answer as it goes into the file', () => {
  test.each([
    [
      'answered by m, 2026-09-12',
      `${ANSWER_OPEN}\n*answered by m, 2026-09-12*\n\nThe heron.\n${ANSWER_CLOSE}`,
      'The heron.',
    ],
    ['said', `${ANSWER_OPEN}\n*said*\n\nOne.\n${ANSWER_CLOSE}`, 'One.\n\n\n'],
  ])('%j', (input, wanted, extra) => expect(answerText(input, extra)).toBe(wanted))

  test('is the two halves a stream writes between', () => {
    const { head, tail } = answerParts('said')
    expect(`${head}One.${tail}`).toBe(answerText('said', 'One.'))
  })
})

describe('finding the answer a fence already has', () => {
  const fence = '```ai\nA question.\n```'

  test('is nothing where the fence has none', () => {
    expect(answerSpan(lines(`${fence}\n\nSomething else.`), 2)).toBeNull()
  })

  test('is the whole span, marks and all', () => {
    const note = `${fence}\n\n${answerText('said', 'The answer.')}\n\nAfter.`
    const span = answerSpan(lines(note), 2)

    expect(span).not.toBeNull()
    expect(note.slice(span?.from, span?.to)).toBe(answerText('said', 'The answer.'))
  })

  test('is found under the marks an older version wrote', () => {
    const old = '<!--nib:ai-->\n*said*\n\nThe answer.\n<!--/nib:ai-->'
    const note = `${fence}\n\n${old}\n\nAfter.`
    const span = answerSpan(lines(note), 2)
    expect(note.slice(span?.from, span?.to)).toBe(old)
  })

  test('reaches over the blank line the answer is separated by', () => {
    const note = `${fence}\n\n\n\n${answerText('said', 'Late.')}`
    expect(answerSpan(lines(note), 2)).not.toBeNull()
  })

  test('is nothing where prose sits between the fence and a later answer', () => {
    const note = `${fence}\n\nA paragraph.\n\n${answerText('said', 'Somebody else.')}`
    expect(answerSpan(lines(note), 2)).toBeNull()
  })

  test('ends at the note where a stream was cut off before the closing mark', () => {
    const note = `${fence}\n\n${ANSWER_OPEN}\n*said*\n\nHalf of it`
    const span = answerSpan(lines(note), 2)

    expect(span?.to).toBe(note.length)
  })

  test('replacing it leaves the note with one answer', () => {
    const note = `${fence}\n\n${answerText('first', 'One.')}\n\nAfter.`
    const span = answerSpan(lines(note), 2)
    const again = note.slice(0, span?.from) + answerText('second', 'Two.') + note.slice(span?.to)

    expect(again).toBe(`${fence}\n\n${answerText('second', 'Two.')}\n\nAfter.`)
    expect(again.match(new RegExp(ANSWER_OPEN, 'g'))).toHaveLength(1)
  })
})
