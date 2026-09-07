import { describe, expect, test } from 'vitest'
import { cleanFolder, inFolder, numbered } from './paths'

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

describe('stepping a name that is taken', () => {
  test('leaves the first one as it is', () => {
    expect(numbered('Idea.md', 1)).toBe('Idea.md')
  })

  test('numbers from two, the way the app numbers a duplicate', () => {
    expect(numbered('Idea.md', 2)).toBe('Idea 2.md')
    expect(numbered('Idea.md', 3)).toBe('Idea 3.md')
  })

  test('puts the number before the extension', () => {
    expect(numbered('a/b/Idea.md', 4)).toBe('a/b/Idea 4.md')
  })

  test('leaves a folder with a dot in its name alone', () => {
    expect(numbered('v1.2/Idea.md', 2)).toBe('v1.2/Idea 2.md')
  })

  test('treats a name that is all extension as a name', () => {
    expect(numbered('.hidden', 2)).toBe('.hidden 2')
  })
})
