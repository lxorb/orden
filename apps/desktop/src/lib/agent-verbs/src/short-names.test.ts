import { expect, test } from 'vitest'

const { judged } = await import('./spaces')

test('an agent names a note in full, never by the short name Windows also opens it by', () => {
  expect(() => judged('PRIVAT~1/Diary.md')).toThrow(/short name/)
  expect(() => judged('THERAP~1.MD')).toThrow(/short name/)
  expect(judged('Private Journal/Diary.md')).toBe('Private Journal/Diary.md')
})
