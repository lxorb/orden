import { describe, expect, test } from 'vitest'
import { folderOf, nameOf, noteName, relativePath, relativeTo } from './space-paths'

describe('a path as the space speaks of it', () => {
  test('drops the root and the platform separators', () => {
    expect(relativeTo('C:\\Notes\\Work', 'C:\\Notes\\Work\\ideas\\Plan.md')).toBe('ideas/Plan.md')
    expect(relativeTo('/notes/work', '/notes/work/ideas/Plan.md')).toBe('ideas/Plan.md')
  })

  test('a path that is not under the root keeps its own shape', () => {
    expect(relativeTo('/notes', '/elsewhere/Plan.md')).toBe('/elsewhere/Plan.md')
  })

  test('names and folders come apart', () => {
    expect(folderOf('ideas/deep/Plan.md')).toBe('ideas/deep')
    expect(folderOf('Plan.md')).toBe('')
    expect(nameOf('ideas/Plan.md')).toBe('Plan.md')
    expect(noteName('ideas/Plan.md')).toBe('Plan')
    expect(noteName('ideas/Plan.markdown')).toBe('Plan')
    expect(noteName('ideas/notes.txt')).toBe('notes.txt')
  })
})

describe('how a markdown link writes its way to a note', () => {
  test('a note in the same folder is named on its own', () => {
    expect(relativePath('ideas', 'ideas/Plan.md')).toBe('Plan.md')
    expect(relativePath('', 'Plan.md')).toBe('Plan.md')
  })

  test('a note deeper down is reached through its folders', () => {
    expect(relativePath('', 'ideas/deep/Plan.md')).toBe('ideas/deep/Plan.md')
    expect(relativePath('ideas', 'ideas/deep/Plan.md')).toBe('deep/Plan.md')
  })

  test('a note above is reached by climbing', () => {
    expect(relativePath('ideas/deep', 'Plan.md')).toBe('../../Plan.md')
    expect(relativePath('ideas/deep', 'ideas/Plan.md')).toBe('../Plan.md')
  })

  test('a note in a sibling folder climbs and descends', () => {
    expect(relativePath('ideas', 'later/Plan.md')).toBe('../later/Plan.md')
  })
})
