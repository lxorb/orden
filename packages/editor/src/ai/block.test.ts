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

/** The lines of a note, as `answerSpan` wants them. */
const lines = (note: string) => note.split('\n')

describe('the ai fence language', () => {
  test('is read whatever case it was written in', () => {
    expect(isAiLanguage('ai')).toBe(true)
    expect(isAiLanguage('AI')).toBe(true)
    expect(isAiLanguage(' ai ')).toBe(true)
  })

  test('is not another language that begins the same way', () => {
    expect(isAiLanguage('aiml')).toBe(false)
    expect(isAiLanguage('')).toBe(false)
  })
})

describe('a prompt asking for the note', () => {
  test('is one that says @note', () => {
    expect(mentionsNote('Summarise @note in three bullets')).toBe(true)
    expect(mentionsNote('@NOTE please')).toBe(true)
  })

  test('is not one that only mentions a note', () => {
    expect(mentionsNote('Write a note about herons')).toBe(false)
    expect(mentionsNote('mail me at me@notebook.ch')).toBe(false)
  })
})

describe('an answer as it goes into the file', () => {
  test('sits between two marks, under a line saying who said it', () => {
    expect(answerText('answered by m, 2026-09-12', 'The heron.')).toBe(
      `${ANSWER_OPEN}\n*answered by m, 2026-09-12*\n\nThe heron.\n${ANSWER_CLOSE}`,
    )
  })

  test('ends where the answer ends, however the model ended it', () => {
    expect(answerText('said', 'One.\n\n\n')).toBe(`${ANSWER_OPEN}\n*said*\n\nOne.\n${ANSWER_CLOSE}`)
  })

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
