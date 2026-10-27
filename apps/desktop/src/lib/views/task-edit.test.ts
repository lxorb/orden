import { taskRowsOfText } from '@nib/bases/tasks'
import { changedTask } from '@nib/markdown/task-edits'
import { describe, expect, test } from 'vitest'
import { changeOf, prefillFor } from './task-edit'

function task(line: string) {
  const found = taskRowsOfText('Notes', 'A.md', line)[0]?.task
  if (!found) throw new Error('no task')
  return found
}

describe('a task in quick add’s field and back', () => {
  test('the field holds what the task says', () => {
    const one = task('- [ ] Call [time:: 16:00] [deadline:: 2026-10-20] #admin ⏫ 📅 2026-10-13')
    expect(prefillFor(one, 'Their number.')).toEqual({
      text: 'Call',
      description: 'Their number.',
      fields: {
        due: '2026-10-13',
        time: '16:00',
        deadline: '2026-10-20',
        priority: 2,
        tags: ['admin'],
        remind: [],
      },
      keep: [{ from: 0, to: 4 }],
    })
  })

  test('the words a task already says are words, each its own span', () => {
    expect(prefillFor(task('- [ ] Fix  p1 bug'), null).keep).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 7 },
      { from: 8, to: 11 },
    ])
  })

  test('saving changes the words and every field, and takes away what is gone', () => {
    const one = task('- [ ] Call [time:: 16:00] #admin ⏫ 📅 2026-10-13')
    const change = changeOf(one, {
      text: 'Call again',
      fields: { due: '2026-10-14', tags: ['admin', 'bank'], remind: [], priority: 1 },
    })
    expect(change).toEqual({
      text: 'Call again',
      due: '2026-10-14',
      time: null,
      recurrence: null,
      priority: 1,
      tags: ['admin', 'bank'],
      remind: [],
      duration: null,
      deadline: null,
    })
  })

  test('a task kept by its scheduled date stays kept by it, and a low priority stays low', () => {
    const one = task('- [ ] Plan 🔽 ⏳ 2026-10-13')
    const change = changeOf(one, {
      text: 'Plan',
      fields: { due: '2026-10-15', tags: [], remind: [] },
    })
    expect(change.scheduled).toBe('2026-10-15')
    expect(change.due).toBeUndefined()
    expect(change.priority).toBe(5)
    expect(change.text).toBeUndefined()
  })

  test('the field holds the words a reader sees, and saving puts the escapes back', () => {
    const one = task('- [ ] milk \\$3 or \\~5 min')
    expect(prefillFor(one, null).text).toBe('milk $3 or ~5 min')
    const kept = changeOf(one, { text: 'milk $3 or ~5 min', fields: { tags: [], remind: [] } })
    expect(kept.text).toBeUndefined()
    const changed = changeOf(one, { text: 'milk $4 or ~5 min', fields: { tags: [], remind: [] } })
    expect(changed.text).toBe('milk \\$4 or \\~5 min')
  })

  test('an edited title keeps the escapes that keep a tag and a field words', () => {
    const one = task('- [ ] Read \\[key:\\: value\\] later \\#tips')
    const change = changeOf(one, {
      text: 'Reread [key:: value] later #tips',
      fields: { tags: [], remind: [] },
    })
    expect(change.text).toBe('Reread \\[key:\\: value\\] later \\#tips')
  })

  test("an edited title leaves the line's own markup as it was written", () => {
    const one = task('- [ ] Read ~~old~~ ==key== $x$ %%note%% <b>b</b> [[Plan#^ab12cd]]')
    const text = `${prefillFor(one, null).text} now`
    expect(changeOf(one, { text, fields: { tags: [], remind: [] } }).text).toBe(
      'Read ~~old~~ ==key== $x$ %%note%% <b>b</b> [[Plan#^ab12cd]] now',
    )
  })

  test('a hash in the code a task ends with is no label, and an edit keeps the code whole', () => {
    const one = task('- [ ] run `git tag #v2`')
    const prefill = prefillFor(one, null)
    expect(prefill.text).toBe('run `git tag #v2`')
    expect(prefill.fields?.tags).toEqual([])
    const text = `${prefill.text} extra`
    expect(changeOf(one, { text, fields: { tags: [], remind: [] } }).text).toBe(
      'run `git tag #v2` extra',
    )
  })

  test('saving a task with a deadline and no start date keeps its repeat and its time', () => {
    const save = (line: string, reads?: 'deadline') => {
      const one = task(line)
      if (reads) one.dueReads = reads
      const fields = { tags: [], remind: [], ...prefillFor(one, null).fields }
      return changedTask(line, changeOf(one, { text: 'Pay rent', fields }))
    }
    // A vault's `📅` is a deadline, and the line stays as it was.
    expect(save('- [ ] Pay rent 🔁 every month 📅 2026-11-01', 'deadline')).toBe(
      '- [ ] Pay rent 🔁 every month 📅 2026-11-01',
    )
    expect(save('- [ ] Pay rent [repeat:: every month] [deadline:: 2026-11-01]')).toBe(
      '- [ ] Pay rent [repeat:: every month] [deadline:: 2026-11-01]',
    )
    expect(save('- [ ] Pay rent [time:: 09:00] [deadline:: 2026-11-01]')).toBe(
      '- [ ] Pay rent [time:: 09:00] [deadline:: 2026-11-01]',
    )
  })

  test('taking its only date away takes the repeat and the time with it', () => {
    const line = '- [ ] Pay rent [time:: 09:00] [repeat:: every month] [deadline:: 2026-11-01]'
    const one = task(line)
    const fields = { tags: [], remind: [], ...prefillFor(one, null).fields }
    delete fields.deadline
    expect(changedTask(line, changeOf(one, { text: 'Pay rent', fields }))).toBe('- [ ] Pay rent')
  })
})
