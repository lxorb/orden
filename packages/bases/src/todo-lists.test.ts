import { describe, expect, test } from 'vitest'
import { rowsOfText } from './note-rows'
import {
  CANCELLED_KEY,
  datesChanged,
  datesOf,
  datesText,
  DONE_KEY,
  inOldFolder,
  isTodoList,
  LIST_KEY,
  LIST_VALUE,
  withDates,
  writtenDates,
} from './todo-lists'

const rows = (text: string) => rowsOfText('Mine', 'Errands.md', text)

describe('a todo list (#1229)', () => {
  test('is the inbox, the note chosen as the inbox, or a note Orden made one', () => {
    expect(isTodoList('.Inbox.md', null)).toBe(true)
    expect(isTodoList('Lists/Inbox.md', null, 'Lists/Inbox.md')).toBe(true)
    expect(isTodoList('Errands.md', { [LIST_KEY]: LIST_VALUE })).toBe(true)
  })

  test('is a note in Projects carrying no mark, until the space is marked (#1333)', () => {
    expect(inOldFolder('Projects/Garden.md', null, false)).toBe(true)
    expect(inOldFolder('projects/Work/Hiring.md', { icon: 'star' }, false)).toBe(true)
    expect(inOldFolder('Projects/Garden.md', null, true)).toBe(false)
    expect(inOldFolder('Projects/Garden.md', { [LIST_KEY]: 'no' }, false)).toBe(false)
    expect(inOldFolder('Garden.md', null, false)).toBe(false)
    expect(inOldFolder('Projects/plan.canvas', null, false)).toBe(false)
  })

  test('is never a note by where it is, the Projects folder included', () => {
    expect(isTodoList('Projects/Errands.md', null)).toBe(false)
    expect(isTodoList('Notes/Meeting.md', { icon: 'star' })).toBe(false)
  })
})

describe('done dates kept as the list’s metadata (#1228)', () => {
  const today = '2026-11-06'

  test('ticking a todo records today, its words untouched', () => {
    const before = rows('- [ ] Post the letter\n- [ ] Call the bank\n')
    const after = rows('- [x] Post the letter\n- [ ] Call the bank\n')
    const patch = datesChanged(before, after, null, today)
    expect(patch).toEqual({ [DONE_KEY]: expect.any(String) })
    const dated = withDates(after, patch as Record<string, string>)
    expect(dated.find((row) => row.task?.done)?.task?.completed).toBe(today)
    expect(dated.find((row) => row.task?.done)?.task?.text).toBe('Post the letter')
  })

  test('a done todo whose words are edited keeps its date', () => {
    const meta = {
      [DONE_KEY]:
        datesText(new Map([[rows('- [x] Post it\n')[1]?.anchor?.hash ?? '', '2026-11-01']])) ?? '',
    }
    const before = rows('- [x] Post it\n')
    const after = rows('- [x] Post the letter\n')
    const patch = datesChanged(before, after, meta, today)
    const dated = withDates(after, { ...meta, ...patch })
    expect(dated.find((row) => row.task)?.task?.completed).toBe('2026-11-01')
  })

  test('unticking forgets the date, and cancelling keeps its own', () => {
    const before = rows('- [x] Post it\n- [ ] Gym\n')
    const ticked = datesChanged(rows('- [ ] Post it\n- [ ] Gym\n'), before, null, today)
    const meta = { ...ticked } as Record<string, string>
    const after = rows('- [ ] Post it\n- [-] Gym\n')
    expect(datesChanged(before, after, meta, today)).toEqual({
      [DONE_KEY]: null,
      [CANCELLED_KEY]: expect.any(String),
    })
  })

  test('a list read for the first time has no todo stamped with today', () => {
    expect(datesChanged(null, rows('- [x] Old one\n'), null, today)).toBeNull()
  })

  test('an old ✅ mark is still the done date and wins', () => {
    const after = rows('- [x] Old one ✅ 2026-01-02\n')
    const meta = { [DONE_KEY]: datesText(new Map([[after[1]?.anchor?.hash ?? '', today]])) ?? '' }
    expect(withDates(after, meta).find((row) => row.task)?.task?.completed).toBe('2026-01-02')
  })

  test('the dates fit the metadata, the newest kept', () => {
    const many = new Map(
      Array.from({ length: 400 }, (_, at) => [
        `h${at}`,
        `2026-${String((at % 12) + 1).padStart(2, '0')}-01`,
      ]),
    )
    const text = datesText(many) ?? ''
    expect(text.length).toBeLessThanOrEqual(2048)
    expect([...datesOf(text).values()].flat()).toContain('2026-12-01')
  })
})

describe('two todos with the same words keep their own dates (#1401)', () => {
  type Kept = Record<string, string>
  const twice = '- [ ] Call mom\n- [ ] Call mom\n'
  const daysOf = (text: string, meta: Kept) =>
    withDates(rows(text), meta)
      .filter((row) => row.task)
      .map((row) => row.task?.completed ?? row.task?.cancelledOn ?? null)
  const step = (meta: Kept, before: string, after: string, today: string): Kept => {
    const patch = datesChanged(rows(before), rows(after), meta, today) ?? {}
    const both = Object.entries({ ...meta, ...patch })
    return Object.fromEntries(both.filter((one): one is [string, string] => one[1] !== null))
  }
  const walk = (texts: readonly string[], days: readonly string[]) => {
    let meta: Kept = {}
    for (const [at, text] of texts.slice(1).entries())
      meta = step(meta, texts[at] ?? '', text, days[at] ?? '')
    return meta
  }

  test('ticking the lower one, then the upper', () => {
    const texts = [twice, '- [ ] Call mom\n- [x] Call mom\n', '- [x] Call mom\n- [x] Call mom\n']
    const meta = walk(texts, ['2026-11-01', '2026-11-05'])
    expect(daysOf(texts[2] ?? '', meta)).toEqual(['2026-11-05', '2026-11-01'])
  })

  test('ticking the upper one, then the lower', () => {
    const texts = [twice, '- [x] Call mom\n- [ ] Call mom\n', '- [x] Call mom\n- [x] Call mom\n']
    const meta = walk(texts, ['2026-11-01', '2026-11-05'])
    expect(daysOf(texts[2] ?? '', meta)).toEqual(['2026-11-01', '2026-11-05'])
  })

  test('unticking one leaves the other its date', () => {
    const both = '- [x] Call mom\n- [x] Call mom\n'
    const meta = walk(
      [twice, '- [ ] Call mom\n- [x] Call mom\n', both],
      ['2026-11-01', '2026-11-05'],
    )
    const upper = '- [ ] Call mom\n- [x] Call mom\n'
    expect(daysOf(upper, step(meta, both, upper, '2026-11-07'))).toEqual([null, '2026-11-01'])
    const lower = '- [x] Call mom\n- [ ] Call mom\n'
    expect(daysOf(lower, step(meta, both, lower, '2026-11-07'))).toEqual(['2026-11-05', null])
  })

  test('deleting one leaves the other its date', () => {
    const three = '- [x] Call mom\n- [ ] Call mom\n- [x] Call mom\n'
    const meta = walk(
      [
        '- [ ] Call mom\n- [ ] Call mom\n- [ ] Call mom\n',
        '- [x] Call mom\n- [ ] Call mom\n- [ ] Call mom\n',
        three,
      ],
      ['2026-11-01', '2026-11-05'],
    )
    const gone = '- [ ] Call mom\n- [x] Call mom\n'
    expect(daysOf(gone, step(meta, three, gone, '2026-11-07'))).toEqual([null, '2026-11-05'])
    const open = '- [x] Call mom\n- [x] Call mom\n'
    expect(daysOf(open, step(meta, three, open, '2026-11-07'))).toEqual([
      '2026-11-01',
      '2026-11-05',
    ])
  })

  test('a moved one takes its date along', () => {
    const done = '- [x] Call mom\n- [ ] Call mom\n- [ ] Gym\n'
    const meta = walk([twice + '- [ ] Gym\n', done], ['2026-11-01'])
    const moved = '- [ ] Call mom\n- [ ] Gym\n- [x] Call mom\n'
    expect(daysOf(moved, step(meta, done, moved, '2026-11-07'))).toEqual([null, null, '2026-11-01'])
  })

  test('editing the words of one keeps both dates', () => {
    const both = '- [x] Call mom\n- [x] Call mom\n'
    const meta = walk(
      [twice, '- [x] Call mom\n- [ ] Call mom\n', both],
      ['2026-11-01', '2026-11-05'],
    )
    const edited = '- [x] Call mom\n- [x] Call dad\n'
    expect(daysOf(edited, step(meta, both, edited, '2026-11-07'))).toEqual([
      '2026-11-01',
      '2026-11-05',
    ])
  })

  test('a tick from another device gives the same dates whether its metadata comes first or last', () => {
    const lower = '- [ ] Call mom\n- [x] Call mom\n'
    const both = '- [x] Call mom\n- [x] Call mom\n'
    const there = walk([twice, lower, both], ['2026-11-01', '2026-11-05'])
    const here = walk([twice, lower], ['2026-11-01'])
    expect(datesChanged(rows(lower), rows(both), there, '2026-11-05')).toBeNull()
    expect(daysOf(both, step(there, lower, both, '2026-11-05'))).toEqual([
      '2026-11-05',
      '2026-11-01',
    ])
    expect(step(here, lower, both, '2026-11-05')).toEqual(there)
    const unticked = '- [x] Call mom\n- [ ] Call mom\n'
    const later = step(there, both, unticked, '2026-11-06')
    expect(daysOf(unticked, step(later, both, unticked, '2026-11-06'))).toEqual([
      '2026-11-05',
      null,
    ])
  })

  test('cancelling each keeps its own day', () => {
    const texts = [twice, '- [ ] Call mom\n- [-] Call mom\n', '- [-] Call mom\n- [-] Call mom\n']
    const meta = walk(texts, ['2026-11-01', '2026-11-05'])
    expect(daysOf(texts[2] ?? '', meta)).toEqual(['2026-11-05', '2026-11-01'])
  })

  test('an old single date is still read, for each todo with those words', () => {
    const both = '- [x] Call mom\n- [x] Call mom\n'
    const hash = rows(both)[1]?.anchor?.hash ?? ''
    const old = { [DONE_KEY]: `${hash}:20261101` }
    expect(daysOf(both, old)).toEqual(['2026-11-01', '2026-11-01'])
    const more = `${both}- [x] Call mom\n`
    expect(daysOf(more, step(old, `${both}- [ ] Call mom\n`, more, '2026-11-05'))).toEqual([
      '2026-11-01',
      '2026-11-01',
      '2026-11-05',
    ])
  })

  test('taken out of Orden, each gets its own ✅', () => {
    const both = '- [x] Call mom\n- [x] Call mom\n'
    const meta = walk(
      [twice, '- [ ] Call mom\n- [x] Call mom\n', both],
      ['2026-11-01', '2026-11-05'],
    )
    expect(writtenDates(both, meta)).toBe(
      '- [x] Call mom ✅ 2026-11-05\n- [x] Call mom ✅ 2026-11-01\n',
    )
  })
})

describe('a list taken out of Orden (#1229)', () => {
  test('has its kept done and cancelled dates written as ✅ and ❌, its own marks kept', () => {
    const text = '# Errands\n- [x] Post it\n- [-] Gym\n- [x] Old one ✅ 2026-01-02\n- [ ] Milk\n'
    const hash = (line: string) => rows(line)[1]?.anchor?.hash ?? ''
    const meta = {
      [DONE_KEY]:
        datesText(
          new Map([
            [hash('- [x] Post it\n'), '2026-11-01'],
            [hash('- [x] Old one ✅ 2026-01-02\n'), '2026-11-02'],
          ]),
        ) ?? '',
      [CANCELLED_KEY]: datesText(new Map([[hash('- [-] Gym\n'), '2026-11-03']])) ?? '',
    }
    expect(writtenDates(text, meta)).toBe(
      '# Errands\n- [x] Post it ✅ 2026-11-01\n- [-] Gym ❌ 2026-11-03\n- [x] Old one ✅ 2026-01-02\n- [ ] Milk\n',
    )
    expect(writtenDates('- [x] Post it\r\n', meta)).toBe('- [x] Post it ✅ 2026-11-01\r\n')
    expect(writtenDates(text, null)).toBe(text)
  })
})
