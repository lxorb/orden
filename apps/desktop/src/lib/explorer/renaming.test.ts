import { describe, expect, test } from 'vitest'
import { clashing, renamedAll } from './renaming'

describe('renaming many at once', () => {
  test('replaces words in the names and leaves the endings alone', () => {
    expect(
      renamedAll(['IMG_001.jpg', 'IMG_002.JPG'], {
        find: 'IMG_',
        replace: 'Rome ',
        numbered: false,
      }),
    ).toEqual(['Rome 001.jpg', 'Rome 002.JPG'])
    expect(renamedAll(['report.pdf'], { find: 'pdf', replace: 'x', numbered: false })).toEqual([
      'report.pdf',
    ])
  })

  test('numbers them in their order, as wide as the last number', () => {
    const names = Array.from({ length: 10 }, (_, at) => `scan ${at}.png`)
    const next = renamedAll(names, { find: '', replace: '', numbered: true })
    expect(next[0]).toBe('scan 0 01.png')
    expect(next[9]).toBe('scan 9 10.png')
  })

  test('never leaves a name empty', () => {
    expect(renamedAll(['abc.txt'], { find: 'abc', replace: '', numbered: false })).toEqual([
      'abc.txt',
    ])
  })

  test('says which would land on a name already there or on each other', () => {
    expect([
      ...clashing(['a.txt', 'b.txt'], ['c.txt', 'c.txt'], ['a.txt', 'b.txt', 'd.txt']),
    ]).toEqual([0, 1])
    expect([...clashing(['a.txt'], ['d.txt'], ['a.txt', 'd.txt'])]).toEqual([0])
    expect([...clashing(['a.txt', 'b.txt'], ['b.txt', 'a.txt'], ['a.txt', 'b.txt'])]).toEqual([])
  })
})
