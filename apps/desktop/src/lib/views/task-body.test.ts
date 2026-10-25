import { taskHash } from '@nib/bases'
import { taskRowsOfText } from '@nib/bases/tasks'
import { describe, expect, test } from 'vitest'
import {
  commentsOf,
  descriptionOf,
  withComment,
  withDescription,
  withoutComment,
  withSubtask,
} from './task-body'

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

  test('a description written at every pause is the one description, read back as typed', () => {
    // The task view writes its whole text a moment after each pause in the typing.
    const task = at(0, 'task')
    let note = '- [ ] task\n'
    for (const typed of ['hello\n- a', 'hello\n- ab', 'hello\n- abc']) {
      note = withDescription(note, task, typed) ?? note
      expect(descriptionOf(note, task)?.text).toBe(typed)
    }
    expect(note).toBe('- [ ] task\n  hello\n  \\- abc\n')
    // A task typed into it is words of the description, never a sub-task.
    const sub = withDescription(note, task, '- [ ] x') ?? note
    expect(descriptionOf(sub, task)?.text).toBe('- [ ] x')
    expect(withDescription(sub, task, '- [ ] xy')?.split('\n')).toEqual([
      '- [ ] task',
      '  \\- [ ] xy',
      '',
    ])
  })

  test('any description reads back as it was written', () => {
    const task = at(0, 'task')
    for (const words of [
      '- a',
      '* b\n+ c',
      '1. one\n2) two',
      '\\- an escape typed',
      '1\\. so is this',
      '  - indented',
      '-not a list',
      'words\n\n- after a gap',
      '-',
    ]) {
      const note = withDescription('- [ ] task\n- [ ] next\n', task, words) ?? ''
      expect(descriptionOf(note, task)?.text, words).toBe(words)
      expect(note.split('\n').at(-2), words).toBe('- [ ] next')
    }
  })

  test('a code block is written as typed, its lists no list items of the task', () => {
    const task = at(0, 'Fix config')
    const typed =
      'Change it to:\n\n```yaml\nhosts:\n- alpha\n```\n\n~~~diff\n- old\n+ new\n1. [ ] x\n~~~'
    const note = withDescription('- [ ] Fix config\n- [ ] Next\n', task, typed) ?? ''
    expect(note.split('\n').slice(4, 12)).toEqual([
      '  hosts:',
      '  - alpha',
      '  ```',
      '',
      '  ~~~diff',
      '  - old',
      '  + new',
      '  1. [ ] x',
    ])
    expect(descriptionOf(note, task)?.text).toBe(typed)
    expect(withDescription(note, task, typed)).toBeNull()
    expect(commentsOf(note, task)).toEqual([])
    expect(taskRowsOfText('S', 'n.md', note).map((row) => row.task?.text)).toEqual([
      'Fix config',
      'Next',
    ])
    // A fence left open is no code block yet: it is written escaped, or it would hide
    // every later line of the note from the index, and what follows it stays escaped.
    const open = withDescription('- [ ] Fix config\n- [ ] Next\n', task, '```\n- a') ?? ''
    expect(open).toBe('- [ ] Fix config\n  \\```\n  \\- a\n- [ ] Next\n')
    expect(descriptionOf(open, task)?.text).toBe('```\n- a')
    expect(taskRowsOfText('S', 'n.md', open).map((row) => row.task?.text)).toEqual([
      'Fix config',
      'Next',
    ])
    const typedEscape = withDescription('- [ ] Fix config\n', task, '\\```\n~~~') ?? ''
    expect(typedEscape).toBe('- [ ] Fix config\n  \\\\```\n  \\~~~\n')
    expect(descriptionOf(typedEscape, task)?.text).toBe('\\```\n~~~')
  })

  test('a code block under a tab-indented task in a CRLF note is written as typed', () => {
    const task = at(1, 'Task')
    const note = '# H\r\n\t- [ ] Task\r\n- [ ] Next\r\n'
    const typed = '```\n- a\n```\n~~~'
    const written = withDescription(note, task, typed) ?? ''
    expect(written).toBe(
      '# H\r\n\t- [ ] Task\r\n\t  ```\r\n\t  - a\r\n\t  ```\r\n\t  \\~~~\r\n- [ ] Next\r\n',
    )
    expect(descriptionOf(written, task)?.text).toBe(typed)
    expect(withDescription(written, task, typed)).toBeNull()
    expect(taskRowsOfText('S', 'n.md', written).map((row) => row.task?.text)).toEqual([
      'Task',
      'Next',
    ])
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

describe('a task’s comments', () => {
  const bank = at(1, 'Call the bank')

  test('are the list items straight under it that are no tasks', () => {
    expect(commentsOf(NOTE, bank)).toEqual([{ line: 6, text: 'Called once.' }])
    expect(commentsOf(NOTE, at(7, 'Water the plants'))).toEqual([])
  })

  test('are added after the last one, stamped, and read back with their moment', () => {
    const one = withComment(NOTE, bank, 'Called again.\nNo answer.', '2026-10-13T09:30')
    expect(one?.split('\n').slice(6, 9)).toEqual([
      '  - Called once.',
      '  - Called again. [at:: 2026-10-13T09:30]',
      '    No answer.',
    ])
    expect(commentsOf(one ?? '', bank).at(-1)).toEqual({
      line: 7,
      text: 'Called again.\nNo answer.',
      at: '2026-10-13T09:30',
    })
    expect(withComment(NOTE, bank, '   ', '2026-10-13T09:30')).toBeNull()
  })

  test('that open with a box stay comments, read back as written', () => {
    const one = withComment(NOTE, bank, '[ ] not a task', '2026-10-13T09:30') ?? ''
    expect(one.split('\n')[7]).toBe('  - \\[ ] not a task [at:: 2026-10-13T09:30]')
    expect(commentsOf(one, bank).at(-1)?.text).toBe('[ ] not a task')
  })

  test('with a checklist on a later line stay one comment and add no task', () => {
    const plan = at(0, 'Plan trip')
    const note = '- [ ] Plan trip\n  - [ ] Book hotel\n'
    const typed = 'Options we discussed:\n- [ ] train\n* [x] car\n1. [ ] bus\n\\- [ ] typed escape'
    const one = withComment(note, plan, typed, '2026-10-24T10:00') ?? ''
    expect(one.split('\n').slice(3, 7)).toEqual([
      '    - \\[ ] train',
      '    * \\[x] car',
      '    1. \\[ ] bus',
      '    \\- [ ] typed escape',
    ])
    expect(taskRowsOfText('S', 'n.md', one).map((row) => row.task?.text)).toEqual([
      'Plan trip',
      'Book hotel',
    ])
    expect(commentsOf(one, plan).map((comment) => comment.text)).toEqual([typed])
  })

  test('are deleted with their further lines', () => {
    const one = withComment(NOTE, bank, 'Called again.\nNo answer.', '2026-10-13T09:30') ?? ''
    expect(withoutComment(one, bank, 7)).toBe(NOTE)
    expect(withoutComment(NOTE, bank, 5)).toBeNull()
  })
})

describe('what is written under a task, fuzzed', () => {
  let seed = 7
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  const pick = <T>(from: readonly T[]): T => from[random(from.length)] as T
  const STARTS = ['- ', '\\- ', '1. ', '1\\. ', '* ', '+ ', '  ', '\t', '[ ] ', '\\[ ] ', '', '-']
  const FENCES = ['```', '~~~', '```js', '\\```', '\\\\~~~', '   ```', '    ```', '\t```']
  const MORE = ['x ', '> ', '# ', '    - ', '- [ ] ', '* [x] ', '1. [ ] ', '\\- [ ] ', '- \\[ ] ']
  const WORDS = ['a', 'b c', ' ', '', '- d', '\\', '[x]', '[ ] e']
  const line = () => (random(6) === 0 ? pick(FENCES) : pick([...STARTS, ...MORE]) + pick(WORDS))
  /** Words as they are typed: lines, and code blocks that are closed. */
  function typed(): string {
    const out: string[] = []
    for (let n = 1 + random(5); n > 0; n--) {
      if (random(4) > 0) out.push(line())
      else {
        const fence = pick(['```', '~~~', '```yaml'])
        out.push(fence)
        for (let inner = random(4); inner > 0; inner--) out.push(line())
        out.push(fence.slice(0, 3))
      }
    }
    return out.join('\n')
  }
  /** The note's tasks, each with the task and the heading it is under. */
  const tasksOf = (note: string) => {
    const rows = taskRowsOfText('S', 'n.md', note)
    const at = new Map(rows.map((row) => [row.anchor?.line, row.task?.text]))
    return rows.map((row) => [row.task?.text, at.get(row.task?.parent), row.task?.section])
  }
  const NOTES = [
    ['- [ ] Task', '  - [ ] Sub', '  - c1 [at:: 2026-01-01T00:00]', '- [ ] Next'].join('\n'),
    ['# H', '1. [ ] Task', '   said', '- [ ] Next'].join('\n'),
    ['\t- [ ] Task', '\t  old', '- [ ] Next'].join('\r\n'),
    ['- [ ] Top', '  - [ ] Task', '    - [ ] Sub', '- [ ] Next'].join('\n'),
    ['10. [ ] Task', '- [ ] Next'].join('\n'),
    ['- [ ] Task', '## After', '- [ ] Next', '```', '- [ ] code', '```', '- [ ] Last'].join('\n'),
  ]

  test('any description and any comment read back as typed and change no task', () => {
    for (let round = 0; round < 4000; round++) {
      const note = NOTES[round % NOTES.length] ?? ''
      const task = at(
        note.split('\n').findIndex((one) => one.includes('Task')),
        'Task',
      )
      const words = typed()
      const before = tasksOf(note)

      const described = withDescription(note, task, words)
      if (described !== null) {
        expect(descriptionOf(described, task)?.text.trimEnd(), words).toBe(words.trimEnd())
        expect(withDescription(described, task, words), words).toBeNull()
        expect(tasksOf(described), words).toEqual(before)
        expect(commentsOf(described, task), words).toEqual(
          commentsOf(note, task).map((one) => ({
            ...one,
            line: one.line + described.split('\n').length - note.split('\n').length,
          })),
        )
      }

      const commented = withComment(note, task, words, '2026-10-24T10:00')
      if (commented === null) continue
      const want = words
        .split('\n')
        .map((one) => one.trim())
        .filter(Boolean)
        .join('\n')
      expect(commentsOf(commented, task).at(-1)?.text, words).toBe(want)
      expect(tasksOf(commented), words).toEqual(before)
      expect(descriptionOf(commented, task)?.text, words).toBe(descriptionOf(note, task)?.text)
    }
  })
})
