import { readBase, writeBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { taskRow } from './fixture'
import { counted, filterBase, queryOf } from './filters'

const TODAY = '2026-10-13'
const reading = { lang: 'en', today: TODAY }

describe('a filter', () => {
  test('is a base of the query, which it keeps as it was typed', () => {
    const base = filterBase('Urgent', 'p1 & today', reading)
    expect(base.views).toHaveLength(1)
    expect(base.views[0]?.name).toBe('Urgent')
    const back = readBase(writeBase(base))
    expect(queryOf(back)).toBe('p1 & today')
    expect(back.views[0]?.filters).toEqual(base.views[0]?.filters)
  })

  test('draws each list a comma separates as a view of its own', () => {
    const base = filterBase('Week', 'today, overdue', reading)
    expect(base.views.map((one) => one.name)).toEqual(['Week', 'overdue'])
  })

  test('counts what it finds, and says where it cannot be read', () => {
    const rows = [
      taskRow('A.md', `- [ ] Call 🔺 📅 ${TODAY}`, 0),
      taskRow('A.md', `- [ ] Wait 📅 ${TODAY}`, 1),
      taskRow('A.md', '- [ ] Later', 2),
    ]
    expect(counted('today', rows, reading)).toEqual({ count: 2 })
    expect(counted('', rows, reading)).toEqual({ count: 0 })
    expect('error' in counted('today & (', rows, reading)).toBe(true)
  })
})
