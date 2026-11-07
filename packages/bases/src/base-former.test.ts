import { describe, expect, test } from 'vitest'
import { readBase, writeBase } from './base-file'

describe('a base written under the old name', () => {
  const OLD = [
    'views:',
    '  - type: table',
    '    name: All',
    '    # rows',
    '    nib:',
    '      rows: tasks',
    'nib:',
    "  template: '[[Templates/Bug]]'",
    '',
  ].join('\n')

  test('is read as it was', () => {
    const base = readBase(OLD)
    expect(base.orden.template).toBe('[[Templates/Bug]]')
    expect(base.views[0]?.orden.rows).toBe('tasks')
    expect(base.kept).toEqual({})
    expect(base.views[0]?.options).toEqual({})
  })

  test('comes back unchanged when nothing changed', () => {
    expect(writeBase(readBase(OLD), OLD)).toBe(OLD)
  })

  test('takes the new name in place on its next change, comments and all', () => {
    const base = readBase(OLD)
    base.orden.locked = true
    const written = writeBase(base, OLD)
    expect(written).toBe(
      OLD.replace('    nib:', '    orden:').replace('\nnib:', '\norden:') + '  locked: true\n',
    )
    expect(readBase(written).views[0]?.orden.rows).toBe('tasks')
  })

  test('prefers the new key when a newer copy wrote both', () => {
    const base = readBase('orden:\n  template: new\nnib:\n  template: old\n')
    expect(base.orden.template).toBe('new')
    expect(base.kept).toEqual({})
  })
})
