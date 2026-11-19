import { expect, test } from 'vitest'
import { pastedLines, without } from './field'

test('a chip taken out closes the gap it leaves', () => {
  expect(without('Call mum tomorrow at noon', { from: 9, to: 17 })).toBe('Call mum at noon')
  expect(without('tomorrow call mum', { from: 0, to: 8 })).toBe('call mum')
})
test('a paste of several lines is a task a line, each without the mark it was copied with', () => {
  expect(pastedLines('- [ ] Milk\r\n* Bread tomorrow\n\n2. Eggs #shop\n   \n• Butter\nplain words')).toEqual([
    'Milk',
    'Bread tomorrow',
    'Eggs #shop',
    'Butter',
    'plain words',
  ])
  expect(pastedLines('one line')).toEqual(['one line'])
})
