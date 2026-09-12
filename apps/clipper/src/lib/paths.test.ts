import { describe, expect, test } from 'vitest'
import { cleanFolder, inFolder } from './paths'

describe('the folder a clip is aimed at', () => {
  test('leaves an ordinary one alone', () => {
    expect(cleanFolder('Reading/2026')).toBe('Reading/2026')
  })

  test('speaks in forward slashes whichever were typed', () => {
    expect(cleanFolder('Reading\\2026')).toBe('Reading/2026')
  })

  test('drops the slashes around it', () => {
    expect(cleanFolder('/Reading/')).toBe('Reading')
  })

  test('cannot climb out of the space', () => {
    expect(cleanFolder('../../etc')).toBe('etc')
    expect(cleanFolder('a/../b')).toBe('a/b')
    expect(cleanFolder('./a')).toBe('a')
  })

  test('takes out what a filesystem refuses', () => {
    expect(cleanFolder('Read<ing>')).toBe('Read ing')
  })

  test('answers nothing for nothing, which means the top of the space', () => {
    expect(cleanFolder('')).toBe('')
    expect(cleanFolder('///')).toBe('')
  })
})

describe('where the note goes', () => {
  test('is inside the folder when there is one', () => {
    expect(inFolder('Reading', 'A title.md')).toBe('Reading/A title.md')
  })

  test('is the top of the space when there is not', () => {
    expect(inFolder('', 'A title.md')).toBe('A title.md')
  })

  test('cleans the folder on the way', () => {
    expect(inFolder('/Reading/2026/', 'A.md')).toBe('Reading/2026/A.md')
  })
})
