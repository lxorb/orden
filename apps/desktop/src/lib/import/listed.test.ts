import { describe, expect, test } from 'vitest'
import { taskHash } from '@orden/bases'
import { taskRowsOfText } from '@orden/bases/tasks'
import { CANCELLED_KEY, datesText, DONE_KEY } from '@orden/bases/todo-lists'
import { keptText } from '../export/kept'
import { listKeyTaken } from './listed'

describe('a note brought in that says it is a todo list (#1344)', () => {
  test('is a list by its metadata, and the key leaves its words', () => {
    expect(listKeyTaken('---\ntodo-list: yes\n---\n- [ ] Post it\n')).toEqual({
      meta: { 'todo-list': 'yes' },
      text: '- [ ] Post it\n',
    })
  })

  test('that was stopped stays stopped', () => {
    expect(listKeyTaken('---\ntitle: Errands\ntodo-list: no\n---\n- [ ] Post it\n')).toEqual({
      meta: { 'todo-list': 'no' },
      text: '---\ntitle: Errands\n---\n- [ ] Post it\n',
    })
  })

  test('is left as written where the key says something Orden never wrote', () => {
    expect(listKeyTaken('---\ntodo-list: maybe\n---\n- [ ] Post it\n')).toBeNull()
    expect(listKeyTaken('- [ ] Post it\n')).toBeNull()
  })
})

describe('a todo list exported and imported again', () => {
  test('is still a list, with every todo and the day each was done or cancelled', async () => {
    const meta = {
      'todo-list': 'yes',
      [DONE_KEY]: datesText(new Map([[taskHash('Post it'), '2026-11-01']])) ?? '',
      [CANCELLED_KEY]: datesText(new Map([[taskHash('Call Sam'), '2026-11-02']])) ?? '',
    }
    const out = await keptText('- [x] Post it\n- [-] Call Sam\n- [ ] Buy milk\n', meta, true)

    const taken = listKeyTaken(out)
    expect(taken?.meta).toEqual({ 'todo-list': 'yes' })
    const rows = taskRowsOfText('Notes', 'Errands.md', taken?.text ?? '')
    expect(rows.map((row) => [row.task?.done, row.task?.completed])).toEqual([
      [true, '2026-11-01'],
      [false, undefined],
      [false, undefined],
    ])
    expect(rows[1]?.task?.cancelledOn).toBe('2026-11-02')
    expect(rows.map((row) => row.task?.text)).toEqual(['Post it', 'Call Sam', 'Buy milk'])
  })

  test('that was stopped is stopped again', async () => {
    const out = await keptText('- [ ] Post it\n', { 'todo-list': 'no' }, false)
    expect(listKeyTaken(out)?.meta).toEqual({ 'todo-list': 'no' })
  })

  test('says nothing of lists for a note that never was one', async () => {
    expect(await keptText('- [ ] Post it\n', null, false)).toBe('- [ ] Post it\n')
  })
})
