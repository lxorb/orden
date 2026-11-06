import { describe, expect, test } from 'vitest'
import { rowsOfText } from './note-rows'
import {
  CANCELLED_KEY,
  datesChanged,
  datesOf,
  datesText,
  DONE_KEY,
  isTodoList,
  LIST_KEY,
  LIST_VALUE,
  withDates,
} from './todo-lists'

const rows = (text: string) => rowsOfText('Mine', 'Errands.md', text)

describe('a todo list (#1229)', () => {
  test('is the inbox, the note chosen as the inbox, or a note Orden made one', () => {
    expect(isTodoList('.Inbox.md', null)).toBe(true)
    expect(isTodoList('Lists/Inbox.md', null, 'Lists/Inbox.md')).toBe(true)
    expect(isTodoList('Errands.md', { [LIST_KEY]: LIST_VALUE })).toBe(true)
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
    expect([...datesOf(text).values()]).toContain('2026-12-01')
  })
})
