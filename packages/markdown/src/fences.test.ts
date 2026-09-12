import { describe, expect, test } from 'vitest'
import { closesFence, fenceMark } from './fences'

describe('the mark a fence line carries', () => {
  test('three or more of either character', () => {
    expect(fenceMark('```')).toBe('```')
    expect(fenceMark('````')).toBe('````')
    expect(fenceMark('~~~')).toBe('~~~')
    expect(fenceMark('~~~~~')).toBe('~~~~~')
  })

  test('with the info string after it, which is not part of the mark', () => {
    expect(fenceMark('```ts some/file.ts')).toBe('```')
  })

  test('indented by up to three spaces', () => {
    expect(fenceMark('   ```')).toBe('```')
    expect(fenceMark('    ```')).toBeNull()
  })

  test('and nothing for a line that is not a fence', () => {
    expect(fenceMark('``')).toBeNull()
    expect(fenceMark('a ``` b')).toBeNull()
    expect(fenceMark('')).toBeNull()
  })
})

describe('what closes a fence', () => {
  test('the same character, at least as many of them', () => {
    expect(closesFence('```', '```')).toBe(true)
    expect(closesFence('````', '```')).toBe(true)
    expect(closesFence('```', '````')).toBe(false)
  })

  test('never the other character', () => {
    expect(closesFence('~~~', '```')).toBe(false)
    expect(closesFence('```', '~~~')).toBe(false)
  })

  test('and never a line carrying an info string', () => {
    expect(closesFence('```ts', '```')).toBe(false)
    expect(closesFence('```  ', '```')).toBe(true)
  })

  test('a line that is not a fence at all closes nothing', () => {
    expect(closesFence('const x = 1', '```')).toBe(false)
  })
})
