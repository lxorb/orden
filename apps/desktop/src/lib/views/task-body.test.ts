import { taskHash } from '@orden/bases'
import { taskRowsOfText } from '@orden/bases/tasks'
import { renderMarkdown } from '@orden/markdown'
import { describe, expect, test } from 'vitest'
import {
  commentsOf,
  descriptionOf,
  editedTask,
  askedFor,
  withComment,
  withoutNeedsInput,
  withDescription,
  withoutComment,
  withSubtask,
} from './task-body'
import { changeOf } from './task-edit'

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

  test('indented code is written as typed, and a list item opening a fence is escaped', () => {
    const task = at(0, 'Deploy')
    const typed = 'Diff:\n\n    - old\n    + new'
    const note = withDescription('- [ ] Deploy\n- [ ] Next\n', task, typed) ?? ''
    expect(note).toBe('- [ ] Deploy\n  Diff:\n\n      - old\n      + new\n- [ ] Next\n')
    expect(descriptionOf(note, task)?.text).toBe(typed)
    expect(withDescription(note, task, typed)).toBeNull()
    expect(renderMarkdown(note)).toContain('- old\n+ new')

    const listed = withDescription('- [ ] Deploy\n', task, '- ```\nx\n```') ?? ''
    expect(listed).toBe('- [ ] Deploy\n  \\- ```\n  x\n  \\```\n')
    expect(descriptionOf(listed, task)?.text).toBe('- ```\nx\n```')
  })

  test('a comment that opens code after its mark is a comment, and a description save keeps it', () => {
    const task = at(0, 'Task')
    for (const words of ['>     quoted code', '-     x', '*     x', '2)     x', '1.      x']) {
      const note = withComment('- [ ] Task\n- [ ] Next\n', task, words, '2026-10-24T10:00') ?? ''
      expect(
        commentsOf(note, task).map((one) => one.text),
        words,
      ).toEqual([words])
      expect(descriptionOf(note, task)?.text, words).toBe('')
      const described = withDescription(note, task, 'new words') ?? ''
      expect(
        commentsOf(described, task).map((one) => one.text),
        words,
      ).toEqual([words])

      // Typed as a description, it is escaped, and reads back as typed.
      const typed = withDescription('- [ ] Task\n- [ ] Next\n', task, words) ?? ''
      expect(descriptionOf(typed, task)?.text, words).toBe(words)
      expect(commentsOf(typed, task), words).toEqual([])
    }
  })

  test('a code block under a tab-indented task in a CRLF note is written as typed', () => {
    // Under a task of its own: a tab at the margin with no list above it is indented
    // code to the page, and holds no task.
    const task = at(2, 'Task')
    const note = '# H\r\n- [ ] Top\r\n\t- [ ] Task\r\n- [ ] Next\r\n'
    const typed = '```\n- a\n```\n~~~'
    const written = withDescription(note, task, typed) ?? ''
    expect(written).toBe(
      '# H\r\n- [ ] Top\r\n\t- [ ] Task\r\n\t  ```\r\n\t  - a\r\n\t  ```\r\n\t  \\~~~\r\n- [ ] Next\r\n',
    )
    expect(descriptionOf(written, task)?.text).toBe(typed)
    expect(withDescription(written, task, typed)).toBeNull()
    expect(taskRowsOfText('S', 'n.md', written).map((row) => row.task?.text)).toEqual([
      'Top',
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
  /** Marks with code after them: a quote or an item that opens indented code on its
   *  own line. A heading typed into a description moves the tasks below it into its
   *  section, a separate matter, so these are fuzzed without one. */
  const CODE_AFTER = [
    ...MORE.filter((one) => one !== '# '),
    '>     ',
    '-     ',
    '*     ',
    '2)     ',
    '1.      ',
  ]
  const WORDS = ['a', 'b c', ' ', '', '- d', '\\', '[x]', '[ ] e']
  let marks = MORE
  const line = () => (random(6) === 0 ? pick(FENCES) : pick([...STARTS, ...marks]) + pick(WORDS))
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
    ['- [ ] Top', '\t- [ ] Task', '\t  old', '- [ ] Next'].join('\r\n'),
    ['- [ ] Top', '  - [ ] Task', '    - [ ] Sub', '- [ ] Next'].join('\n'),
    ['10. [ ] Task', '- [ ] Next'].join('\n'),
    ['- [ ] Task', '## After', '- [ ] Next', '```', '- [ ] code', '```', '- [ ] Last'].join('\n'),
  ]

  function roundTrips(rounds: number) {
    for (let round = 0; round < rounds; round++) {
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
  }

  test('any description and any comment read back as typed and change no task', () => {
    marks = MORE
    roundTrips(4000)
  })

  test('and so do ones with code after a quote or a list mark', () => {
    marks = CODE_AFTER
    roundTrips(4000)
  })
})

describe('the task edit field writes its words and its description together', () => {
  const edit = (note: string, text: string, tags: string[], description: string | null) => {
    const row = taskRowsOfText('Notes', 'A.md', note)[0]
    if (!row?.task) throw new Error('no task')
    return editedTask(
      note,
      row,
      changeOf(row.task, { text, fields: { tags, remind: [] } }),
      description,
    )
  }

  test('a label taken off from among the words keeps the new description', () => {
    expect(edit('- [ ] Email #work Bob\n  Old words.\n', 'Email #work Bob', [], 'New words.')).toBe(
      '- [ ] Email Bob\n  New words.\n',
    )
  })

  test('words that end in a tag, or hold an inline field, keep the new description', () => {
    expect(
      edit('- [ ] Email #work Bob\n  Old words.\n', 'Email #work', ['work'], 'New words.'),
    ).toBe('- [ ] Email #work\n  New words.\n')
    expect(edit('- [ ] Email Bob\n  Old words.\n', 'Email [x:: y] Bob', [], 'New words.')).toBe(
      '- [ ] Email [x:: y] Bob\n  New words.\n',
    )
  })

  test('a description alone, or words alone, write only themselves', () => {
    expect(edit('- [ ] Email Bob\n  Old words.\n', 'Email Bob', [], 'New words.')).toBe(
      '- [ ] Email Bob\n  New words.\n',
    )
    expect(edit('- [ ] Email Bob\n  Old words.\n', 'Email Ann', [], 'Old words.')).toBe(
      '- [ ] Email Ann\n  Old words.\n',
    )
    expect(edit('- [ ] Email Bob\n', 'Email Ann', [], null)).toBe('- [ ] Email Ann\n')
  })

  test('a task no longer in the note writes nothing at all, neither part', () => {
    const row = taskRowsOfText('Notes', 'A.md', '- [ ] Email Bob\n')[0]
    if (!row?.task) throw new Error('no task')
    const change = changeOf(row.task, { text: 'Email Ann', fields: { tags: [], remind: [] } })
    expect(editedTask('- [ ] Call Sam\n', row, change, 'New words.')).toBeNull()
  })
})

/** #325: an agent that could not finish a task asks in a comment under it and flags it
 *  `needs-input`; the reader's comment is the answer, and the flag comes off with it. */
describe('a task flagged as needing input', () => {
  test('loses the flag, and keeps every other tag', () => {
    const note = '- [ ] Book the room #work #needs-input\n- [ ] Next\n'
    expect(withoutNeedsInput(note, at(0, 'Book the room'))).toBe(
      '- [ ] Book the room #work\n- [ ] Next\n',
    )
  })

  test('and a task without the flag is left as it is', () => {
    const note = '- [ ] Book the room #work\n'
    expect(withoutNeedsInput(note, at(0, 'Book the room'))).toBe(note)
  })
})

/** #325: a chat that ended with its task neither ticked nor asked about leaves it asking
 *  in the chat's last words, as the button promised; one already settled is left alone. */
describe('a task left asking', () => {
  test('gets the words as a comment, and the flag beside its other tags', () => {
    const note = '- [ ] Write to the landlord #home\n- [ ] Next\n'
    expect(
      askedFor(
        note,
        at(0, 'Write to the landlord'),
        'Which landlord, and about what?',
        '2026-10-28T09:00',
      ),
    ).toBe(
      '- [ ] Write to the landlord #home #needs-input\n' +
        '  - Which landlord, and about what? [at:: 2026-10-28T09:00]\n- [ ] Next\n',
    )
  })

  test('is flagged without a comment where the chat said nothing', () => {
    expect(askedFor('- [ ] Call\n', at(0, 'Call'), '  ', '2026-10-28T09:00')).toBe(
      '- [ ] Call #needs-input\n',
    )
  })

  test('is left alone where it is done, cancelled or asking already', () => {
    for (const line of ['- [x] Call', '- [-] Call', '- [ ] Call #needs-input']) {
      expect(askedFor(`${line}\n`, at(0, 'Call'), 'Words', '2026-10-28T09:00')).toBeNull()
    }
  })
})
