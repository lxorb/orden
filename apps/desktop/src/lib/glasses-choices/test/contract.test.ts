import { describe, expect, test } from 'vitest'
import { bare, bestOf, numberIn } from '../src/commands'

describe('the words the glasses hear', () => {
  test('are compared bare: lower case, no marks, single spaces', () => {
    expect(bare('  Next,  PAGE! ')).toBe('next page')
  })
  test('a number is read from digits or from spoken words', () => {
    expect(numberIn('1 2')).toBe(12)
    expect(numberIn('twenty three')).toBe(23)
    expect(numberIn('two hundred')).toBe(200)
    expect(numberIn('some page')).toBeNull()
  })
  test('a heard name picks the closest one, or none when nothing is near', () => {
    expect(bestOf('lecture', ['Lecture notes', 'Groceries'])).toBe('Lecture notes')
    expect(bestOf('banana', ['Lecture notes', 'Groceries'])).toBeNull()
  })
})
