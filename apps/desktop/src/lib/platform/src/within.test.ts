import { describe, expect, test } from 'vitest'
import { movedTo, within } from './space-paths'

describe('a path that steps back out of a folder', () => {
  test.each([
    ['/s/Work', '/s/Work/../Secret/x.md'],
    ['/s/Work', '/s/Work/a/../../Secret/x.md'],
    ['C:\\s\\Work', 'C:\\s\\Work\\..\\Secret\\x.md'],
    ['/s/Work', '/s/work/../Secret/x.md'],
  ])('is not inside %s: %s', (folder, path) => {
    expect(within(folder, path)).toBeNull()
    expect(movedTo(path, folder, '/s/Elsewhere')).toBeNull()
  })

  test('and a path that only names a dotted file is still inside', () => {
    expect(within('/s/Work', '/s/Work/..notes/x.md')).toBe('..notes/x.md')
    expect(within('/s/Work', '/s/Work/a/b.md')).toBe('a/b.md')
    expect(within('/s/Work', '/s/Work')).toBe('')
  })
})
