import { appliedEdits } from '@orden/markdown/edits'
import { readTask } from '@orden/markdown/task-line'
import { describe, expect, test } from 'vitest'
import { doneCopyId, finish, nextOccurrence, nextRepeat, skip, tick } from './occurrence'
import { growth, GROWS_AT_MOST } from '../../../scripts/growth'

const ticked = (note: string, line: number, today: string, skipPast = true) =>
  appliedEdits(note, tick(note, line, today, { skipPast }))
describe("the Tasks plugin's documented recurring examples, with its own dates", () => {
  test('take out the trash', () => {
    expect(ticked('- [ ] take out the trash 🔁 every Sunday 📅 2021-04-25\n', 0, '2021-04-24', false)).toBe(
      '- [ ] take out the trash 🔁 every Sunday 📅 2021-05-02\n' +
        '- [x] take out the trash 🔁 every Sunday 📅 2021-04-25\n',
    )
  })
  test('sweep the floors, a week late, from the old date', () => {
    expect(ticked('- [ ] sweep the floors 🔁 every week ⏳ 2021-02-06\n', 0, '2022-02-13', false)).toBe(
      '- [ ] sweep the floors 🔁 every week ⏳ 2021-02-13\n' + '- [x] sweep the floors 🔁 every week ⏳ 2021-02-06\n',
    )
  })
  test('sweep the floors when done, from today', () => {
    expect(ticked('- [ ] sweep the floors 🔁 every week when done ⏳ 2021-02-06\n', 0, '2022-02-13')).toBe(
      '- [ ] sweep the floors 🔁 every week when done ⏳ 2022-02-20\n' +
        '- [x] sweep the floors 🔁 every week when done ⏳ 2021-02-06\n',
    )
  })
  test('mow the lawn: every date moves together', () => {
    expect(ticked('-   [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-10-28 📅 2021-10-30', 0, '2021-10-30', false)).toBe(
      '-   [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-11-11 📅 2021-11-13\n' +
        '-   [x] Mow the lawn 🔁 every 2 weeks ⏳ 2021-10-28 📅 2021-10-30',
    )
  })
  test('do stuff every month: the 31st keeps coming back as the month allows', () => {
    let note = '- [ ] do stuff 🔁 every month 📅 2021-10-31'
    const dues: string[] = []
    for (const day of ['2021-10-31', '2021-11-30', '2021-12-31', '2022-01-31', '2022-02-28']) {
      note = ticked(note, 0, day)
      dues.push(readTask(note.split('\n')[0] ?? '')?.due ?? '')
    }
    expect(dues).toEqual(['2021-11-30', '2021-12-31', '2022-01-31', '2022-02-28', '2022-03-31'])
  })
})
describe('ticking', () => {
  test('an ordinary task: the box alone, its words as they were (#1228)', () => {
    expect(ticked('a\n- [ ] Call the bank 📅 2026-10-06\nb', 1, '2026-10-04')).toBe(
      'a\n- [x] Call the bank 📅 2026-10-06\nb',
    )
  })
  test('a done task opens again, and so does a cancelled one', () => {
    expect(ticked('- [x] a ✅ 2026-10-01', 0, '2026-10-04')).toBe('- [ ] a')
    expect(ticked('- [-] a ❌ 2026-10-01', 0, '2026-10-04')).toBe('- [ ] a')
  })
  test('a daily task a week overdue comes back tomorrow, not six days ago', () => {
    expect(ticked('- [ ] Water 🔁 every day 📅 2026-09-27', 0, '2026-10-04')).toBe(
      '- [ ] Water 🔁 every day 📅 2026-10-05\n- [x] Water 🔁 every day 📅 2026-09-27',
    )
  })
  test('a task ticked early steps from its own date', () => {
    expect(ticked('- [ ] Rent 🔁 every month 📅 2026-10-31', 0, '2026-10-04')).toBe(
      '- [ ] Rent 🔁 every month on the 31st 📅 2026-11-30\n- [x] Rent 🔁 every month 📅 2026-10-31',
    )
  })
  test('ticks the open sub-tasks with the parent, and leaves the done ones', () => {
    const note = ['- [ ] Move', '  - [ ] Boxes', '  - [x] Van ✅ 2026-10-01', '  Notes on it', '- [ ] Next'].join('\n')
    expect(ticked(note, 0, '2026-10-04')).toBe(
      ['- [x] Move', '  - [x] Boxes', '  - [x] Van ✅ 2026-10-01', '  Notes on it', '- [ ] Next'].join('\n'),
    )
  })
  test('a recurring parent brings its description and sub-tasks with it, open again', () => {
    const note = [
      '- [ ] Clean 🔁 every week 📅 2026-10-04',
      '  The whole flat.',
      '  - [ ] Kitchen',
      '  - [x] Bath ✅ 2026-10-03',
      '  Took long this time.',
      'after',
    ].join('\n')
    expect(ticked(note, 0, '2026-10-04')).toBe(
      [
        '- [ ] Clean 🔁 every week 📅 2026-10-11',
        '  The whole flat.',
        '  - [ ] Kitchen',
        '  - [ ] Bath',
        '- [x] Clean 🔁 every week 📅 2026-10-04',
        '  The whole flat.',
        '  - [x] Kitchen',
        '  - [x] Bath ✅ 2026-10-03',
        '  Took long this time.',
        'after',
      ].join('\n'),
    )
  })
  test("Orden's fields come along and reminders at a moment move with the dates", () => {
    const line = '- [ ] Call [time:: 16:00] [remind:: 15m, 2026-10-04 09:00] 🔁 every week 📅 2026-10-04'
    expect(ticked(line, 0, '2026-10-04').split('\n')[0]).toBe(
      '- [ ] Call [time:: 16:00] [remind:: 15m, 2026-10-11 09:00] 🔁 every week 📅 2026-10-11',
    )
  })
  test('a rule past its until is ticked and not repeated', () => {
    expect(ticked('- [ ] a 🔁 every day until 2026-10-04 📅 2026-10-04', 0, '2026-10-04')).toBe(
      '- [x] a 🔁 every day until 2026-10-04 📅 2026-10-04',
    )
  })
  test("the plugin's 🏁 delete: the done line goes", () => {
    expect(ticked('- [ ] a 🏁 delete\nb', 0, '2026-10-04')).toBe('b')
    expect(ticked('- [ ] a 🔁 every day 🏁 delete 📅 2026-10-04\nb', 0, '2026-10-04')).toBe(
      '- [ ] a 🔁 every day 🏁 delete 📅 2026-10-05\nb',
    )
  })
  test('a recurring task with no date makes its next line with none, as the plugin does', () => {
    expect(ticked('- [ ] a 🔁 every day', 0, '2026-10-04')).toBe('- [ ] a 🔁 every day\n- [x] a 🔁 every day')
  })
  test('the created date, when asked for', () => {
    const note = '- [ ] a 🔁 every day 📅 2026-10-04'
    expect(appliedEdits(note, tick(note, 0, '2026-10-04', { created: true })).split('\n')[0]).toBe(
      '- [ ] a 🔁 every day ➕ 2026-10-04 📅 2026-10-05',
    )
  })
  test('is nothing on a line that is not a task', () => {
    expect(tick('words', 0, '2026-10-04')).toEqual([])
    expect(tick('words', 3, '2026-10-04')).toEqual([])
  })
  test('the edits are in order and never overlap, so they are one transaction', () => {
    const note = '- [ ] Clean 🔁 every week 📅 2026-10-04\n  - [ ] Kitchen'
    const edits = tick(note, 0, '2026-10-04')
    for (let at = 1; at < edits.length; at++) {
      expect(edits[at]?.from ?? 0).toBeGreaterThanOrEqual(edits[at - 1]?.to ?? 0)
    }
  })
})
describe('skip and finish', () => {
  test('skip moves the dates and ticks nothing', () => {
    const line = '- [ ] a 🔁 every week 📅 2026-10-04'
    expect(appliedEdits(line, skip(line, '2026-10-04'))).toBe('- [ ] a 🔁 every week 📅 2026-10-11')
  })
  test('finish ticks it and takes the rule off', () => {
    const line = '- [ ] a 🔁 every week 📅 2026-10-04'
    expect(appliedEdits(line, finish(line))).toBe('- [x] a 📅 2026-10-04')
  })
  test('a monthly task years overdue comes back next month, not months later', () => {
    expect(ticked('- [ ] Report 🔁 every month on the 1st 📅 2023-01-01', 0, '2026-10-16')).toBe(
      '- [ ] Report 🔁 every month on the 1st 📅 2026-11-01\n' + '- [x] Report 🔁 every month on the 1st 📅 2023-01-01',
    )
  })
  test('the next occurrence of a task that does not repeat is nothing', () => {
    const task = readTask('- [ ] a 📅 2026-10-04')
    expect(task && nextOccurrence(task, '2026-10-04')).toBeNull()
  })
})
describe('a repeat counted from a deadline alone', () => {
  test('moves the deadline on, in both forms', () => {
    expect(ticked('- [ ] Pay [repeat:: every month] [deadline:: 2026-10-01]\n', 0, '2026-10-04')).toBe(
      '- [ ] Pay [repeat:: every month] [deadline:: 2026-11-01]\n' +
        '- [x] Pay [repeat:: every month] [deadline:: 2026-10-01]\n',
    )
    const line = '- [ ] Pay [repeat:: every month] [deadline:: 2026-10-01]'
    expect(appliedEdits(line, skip(line, '2026-10-04'))).toBe(
      '- [ ] Pay [repeat:: every month] [deadline:: 2026-11-01]',
    )
  })
})
describe('a repeating task with a block id', () => {
  test('keeps the id on the line it is on, and the next one has none', () => {
    const note = '- [ ] Gym 🔁 every day 📅 2026-10-04 ^abc\n'
    expect(ticked(note, 0, '2026-10-04', false).split('\n')).toEqual([
      '- [ ] Gym 🔁 every day 📅 2026-10-05',
      '- [x] Gym 🔁 every day 📅 2026-10-04 ^abc',
      '',
    ])
  })
})
describe('a repeat for so many times', () => {
  test('counts down with each tick and stops after the last', () => {
    const first = ticked('- [ ] Pill 🔁 every day for 3 times 📅 2026-10-07\n', 0, '2026-10-07')
    expect(first).toBe(
      '- [ ] Pill 🔁 every day for 2 times 📅 2026-10-08\n' + '- [x] Pill 🔁 every day for 3 times 📅 2026-10-07\n',
    )
    const second = ticked(first, 0, '2026-10-08')
    expect(second.split('\n')[0]).toBe('- [ ] Pill 🔁 every day for 1 time 📅 2026-10-09')
    const last = ticked(second, 0, '2026-10-09')
    expect(last.split('\n')[0]).toBe('- [x] Pill 🔁 every day for 1 time 📅 2026-10-09')
    expect(last.split('\n').filter((line) => line.startsWith('- [ ]'))).toEqual([])
  })
  test('when done keeps its words after the count', () => {
    const next = nextOccurrence(readTask('- [ ] Pill 🔁 every day for 2 times when done 📅 2026-10-07')!, '2026-10-07')
    expect(next?.recurrence).toBe('every day for 1 time when done')
  })
  test('a skip spends one of the times', () => {
    const line = '- [ ] Pill 🔁 every week for 2 times 📅 2026-10-07'
    expect(appliedEdits(line, skip(line, '2026-10-07'))).toBe('- [ ] Pill 🔁 every week for 1 time 📅 2026-10-14')
    const last = '- [ ] Pill 🔁 every week for 1 time 📅 2026-10-14'
    expect(skip(last, '2026-10-14')).toEqual([])
  })
})
describe('ticking every task of a long list', () => {
  test('reads the note once, not once for each task', () => {
    const ticked = (count: number) => {
      const note = Array.from({ length: count }, (_, at) => `- [ ] task ${at} #t`).join('\n')
      for (let at = 0; at < count; at++) tick(note, at, '2026-11-07')
    }
    expect(growth(ticked, 1_000)).toBeLessThan(GROWS_AT_MOST)
  })
})
describe('a note with CRLF line breaks', () => {
  test('loses a ticked task that deletes itself together with its line break', () => {
    const note = 'a\r\n- [ ] x 🏁 delete\r\nb\r\n'
    expect(appliedEdits(note, tick(note, 1, '2026-11-15'))).toBe('a\r\nb\r\n')
  })
  test('gets the next occurrence on a line of its own with the same line break', () => {
    const note = 'a\r\n- [ ] pay 🔁 every day 📅 2026-11-15\r\nb\r\n'
    const ticked = appliedEdits(note, tick(note, 1, '2026-11-15'))
    expect(ticked.split('\r\n')).toHaveLength(5)
    expect(ticked.replace(/\r\n/g, '')).not.toContain('\n')
  })
})
describe('a repeating todo done', () => {
  const at = (repeat: string, start: string | null, deadline: string | null, today: string) =>
    nextRepeat({ repeat, start, deadline }, today)
  test('on a fixed day goes to the next one after today, late or early', () => {
    const monthly = 'every month on the 1st'
    expect(at(monthly, null, '2026-11-01', '2026-11-03')).toEqual({
      repeat: monthly,
      start: null,
      deadline: '2026-12-01',
    })
    expect(at(monthly, null, '2026-11-01', '2026-10-28')?.deadline).toBe('2026-12-01')
    expect(at(monthly, null, '2026-12-01', '2026-11-03')?.deadline).toBe('2027-01-01')
    expect(at('every week on Monday', '2026-11-02', null, '2026-11-19')?.start).toBe('2026-11-23')
  })
  test('when done counts from today', () => {
    const tenDays = 'every 10 days when done'
    expect(at(tenDays, '2026-11-01', null, '2026-11-05')?.start).toBe('2026-11-15')
    expect(at(tenDays, '2026-11-01', null, '2026-10-25')?.start).toBe('2026-11-04')
    expect(at(tenDays, '2026-11-15', null, '2026-11-05')?.start).toBe('2026-11-15')
  })
  test('keeps to the end of a short month', () => {
    expect(at('every month', null, '2026-01-31', '2026-01-31')?.deadline).toBe('2026-02-28')
    expect(at('every month on the last', null, '2026-02-28', '2026-02-28')?.deadline).toBe('2026-03-31')
    expect(at('every month when done', null, null, '2026-01-31')?.start).toBe('2026-02-28')
  })
  test('moves start and deadline together, and starts from today with neither', () => {
    expect(at('every week', '2026-11-02', '2026-11-04', '2026-11-02')).toEqual({
      repeat: 'every week',
      start: '2026-11-09',
      deadline: '2026-11-11',
    })
    expect(at('every month on the 1st', null, null, '2026-11-19')).toEqual({
      repeat: 'every month on the 1st',
      start: '2026-12-01',
      deadline: null,
    })
  })
  test('counts its times down and stops at the last, or on a rule it cannot read', () => {
    expect(at('every day for 1 time', '2026-11-19', null, '2026-11-19')).toBeNull()
    expect(at('every day for 3 times', '2026-11-19', null, '2026-11-19')?.repeat).toBe('every day for 2 times')
    expect(at('now and then', '2026-11-19', null, '2026-11-19')).toBeNull()
  })
})
describe('a monthly or yearly repeat keeps its day across short months', () => {
  const done = (repeat: string, start: string, times: number) => {
    let todo: { repeat: string; start: string | null; deadline: string | null } = { repeat, start, deadline: null }
    const seen: (string | null)[] = []
    for (let step = 0; step < times; step++) {
      const next = nextRepeat(todo, todo.start ?? start)
      if (!next) break
      seen.push(next.start)
      todo = next
    }
    return { seen, repeat: todo.repeat }
  }
  test('a todo every month from the 31st or the 30th', () => {
    expect(done('every month', '2027-01-31', 3).seen).toEqual(['2027-02-28', '2027-03-31', '2027-04-30'])
    expect(done('every month', '2027-01-30', 3).seen).toEqual(['2027-02-28', '2027-03-30', '2027-04-30'])
    expect(done('every month on the 31st', '2027-01-31', 2).seen).toEqual(['2027-02-28', '2027-03-31'])
  })
  test('a todo every year from the 29th of February', () => {
    expect(done('every year', '2028-02-29', 4).seen).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  })
  test('keeps its words when it needs no pinning', () => {
    expect(done('every month when done', '2027-01-31', 1)).toEqual({
      seen: ['2027-02-28'],
      repeat: 'every month when done',
    })
    expect(done('every month', '2027-01-15', 1)).toEqual({ seen: ['2027-02-15'], repeat: 'every month' })
    expect(done('every month for 3 times', '2027-01-31', 1)).toEqual({
      seen: ['2027-02-28'],
      repeat: 'every month on the 31st for 2 times',
    })
  })
  test('a task in a note every month from the 31st', () => {
    let note = '- [ ] Rent 🔁 every month 📅 2026-10-31'
    const seen: string[] = []
    for (let step = 0; step < 3; step++) {
      const task = readTask(note.split('\n')[0] ?? '')
      note = ticked(note, 0, task?.due ?? '')
      seen.push(note.split('\n')[0] ?? '')
    }
    expect(seen).toEqual([
      '- [ ] Rent 🔁 every month on the 31st 📅 2026-11-30',
      '- [ ] Rent 🔁 every month on the 31st 📅 2026-12-31',
      '- [ ] Rent 🔁 every month on the 31st 📅 2027-01-31',
    ])
  })
})
describe('the done copy of one occurrence of a repeating todo', () => {
  const INBOX_ID = /^[A-Za-z0-9_-]{1,64}$/
  const todo = { id: 't0123456789abcde', start: '2026-11-20', deadline: null }
  test('is named by the todo and the day it closes, the same on every device', () => {
    expect(doneCopyId(todo, '2026-11-21')).toBe('t0123456789abcde-2026-11-20')
    expect(doneCopyId(todo, '2026-11-22')).toBe(doneCopyId(todo, '2026-11-21'))
    expect(doneCopyId({ ...todo, start: '2026-11-27' }, '2026-11-21')).not.toBe(doneCopyId(todo, '2026-11-21'))
    expect(doneCopyId({ ...todo, deadline: '2026-11-25' }, '2026-11-21')).toBe('t0123456789abcde-2026-11-25')
    expect(doneCopyId({ ...todo, start: null }, '2026-11-21')).toBe('t0123456789abcde-2026-11-21')
  })
  test('fits an inbox id, a long todo id cut so the day stays', () => {
    expect(doneCopyId(todo, '2026-11-21')).toMatch(INBOX_ID)
    const long = doneCopyId({ ...todo, id: 'x'.repeat(80) }, '2026-11-21')
    expect(long).toMatch(INBOX_ID)
    expect(long).toHaveLength(64)
    expect(long.endsWith('-2026-11-20')).toBe(true)
  })
})
