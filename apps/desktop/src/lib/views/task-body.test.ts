import { taskHash } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { descriptionOf, withDescription, withSubtask } from './task-body'

const NOTE = [
  '# Errands',
  '- [ ] Call the bank',
  '  Their number is on the back.',
  '',
  '  Ask for **Sam**.',
  '  - [ ] Find the card',
  '  - Called once.',
  '- [ ] Water the plants',
  '1. [ ] Numbered',
  '   Under a number.',
].join('\n')

const at = (line: number, words: string) => ({ line, hash: taskHash(words) })

describe('what is written under a task', () => {
  test('its description is the prose before its first list item, its indent taken off', () => {
    expect(descriptionOf(NOTE, at(1, 'Call the bank'))).toEqual({
      from: 2,
      to: 5,
      text: 'Their number is on the back.\n\nAsk for **Sam**.',
    })
    expect(descriptionOf(NOTE, at(7, 'Water the plants'))).toEqual({ from: 8, to: 8, text: '' })
    expect(descriptionOf(NOTE, at(8, 'Numbered'))?.text).toBe('Under a number.')
  })

  test('a description written back is the task’s own, at its content column', () => {
    const after = withDescription(NOTE, at(7, 'Water the plants'), 'Twice a week.\nNot the cactus.')
    expect(after?.split('\n').slice(7, 10)).toEqual([
      '- [ ] Water the plants',
      '  Twice a week.',
      '  Not the cactus.',
    ])
    const numbered = withDescription(NOTE, at(8, 'Numbered'), 'Changed.')
    expect(numbered?.split('\n').at(-1)).toBe('   Changed.')
  })

  test('an empty description takes the lines away, and the same words change nothing', () => {
    const after = withDescription(NOTE, at(1, 'Call the bank'), '')
    expect(after?.split('\n').slice(1, 4)).toEqual([
      '- [ ] Call the bank',
      '  - [ ] Find the card',
      '  - Called once.',
    ])
    expect(
      withDescription(
        NOTE,
        at(1, 'Call the bank'),
        'Their number is on the back.\n\nAsk for **Sam**.',
      ),
    ).toBeNull()
  })

  test('a sub-task goes at the end of what the task holds', () => {
    const after = withSubtask(NOTE, at(1, 'Call the bank'), '- [ ] Call again')
    expect(after?.split('\n').slice(5, 9)).toEqual([
      '  - [ ] Find the card',
      '  - Called once.',
      '  - [ ] Call again',
      '- [ ] Water the plants',
    ])
    expect(withSubtask(NOTE, at(7, 'Water the plants'), '- [ ] Buy soil')?.split('\n')[8]).toBe(
      '  - [ ] Buy soil',
    )
  })

  test('a task that is not there any more is nothing to write', () => {
    expect(descriptionOf(NOTE, at(1, 'Something else'))).toBeNull()
    expect(withDescription(NOTE, at(1, 'Something else'), 'x')).toBeNull()
  })
})
