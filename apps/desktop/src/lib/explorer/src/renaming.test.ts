import { linearly } from '../../../../../../scripts/growth'
import { describe, expect, test } from 'vitest'
import { clashing, crossing, isOneName, renamedAll, swapping } from './renaming'

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

  test('says which would not be one name in the folder', () => {
    expect([
      ...clashing(['a.txt', 'b.txt', 'c.txt'], ['x/a.txt', '..', 'c\\d.txt'], ['a.txt']),
    ]).toEqual([0, 1, 2])
    expect(isOneName('Rome 01.jpg')).toBe(true)
    expect(isOneName(' . ')).toBe(false)
  })

  test('in a space names do not swap places, a respelling of its own name aside', () => {
    expect([...clashing(['a.md', 'b.md'], ['b.md', 'a.md'], ['a.md', 'b.md'], false)]).toEqual([
      0, 1,
    ])
    expect([...clashing(['a.md', 'b.md'], ['A.md', 'b.md'], ['a.md', 'b.md'], false)]).toEqual([])
  })

  test('found below, names clash only with names in their own folder', () => {
    expect([
      ...clashing(['a/x.txt', 'b/y.txt'], ['same.txt', 'same.txt'], ['a/x.txt', 'b/y.txt']),
    ]).toEqual([])
    expect([
      ...clashing(['a/x.txt', 'a/y.txt'], ['same.txt', 'same.txt'], ['a/x.txt', 'a/y.txt']),
    ]).toEqual([0, 1])
    expect([...clashing(['a/x.txt'], ['kept.txt'], ['a/x.txt', 'a/kept.txt'])]).toEqual([0])
    expect([...clashing(['a/x.txt'], ['kept.txt'], ['a/x.txt', 'b/kept.txt'])]).toEqual([])
  })
})

describe('renames that take each other’s names', () => {
  test('are seen within one folder, whatever the case, and not across folders', () => {
    const pair = (from: string, name: string) => ({ from, name })
    expect(crossing([pair('/d/a.txt', 'b.txt'), pair('/d/b.txt', 'c.txt')])).toBe(true)
    expect(crossing([pair('/d/a.txt', 'B.TXT'), pair('/d/b.txt', 'a.txt')])).toBe(true)
    expect(crossing([pair('/d/a.txt', 'b.txt'), pair('/e/b.txt', 'c.txt')])).toBe(false)
    expect(crossing([pair('/d/a.txt', 'A.txt')])).toBe(false)
    expect(crossing([pair('/d/a.txt', 'x.txt'), pair('/d/A.txt', 'a.txt')])).toBe(true)
  })

  test('are looked for in time that grows with the files, not their square', () => {
    const many = Array.from({ length: 40_000 }, (_, at) => ({
      from: `/home/me/Photos/IMG_${at}.jpg`,
      name: `Rome ${at}.jpg`,
    }))
    expect(linearly((count) => crossing(many.slice(0, count)), 40_000)).toBe(false)
  })

  test('moved back are looked for in time that grows with the files, not their square', () => {
    const many = Array.from({ length: 40_000 }, (_, at) => ({
      from: `/home/me/Photos/Rome/IMG_${at}.jpg`,
      to: `/home/me/Photos/IMG_${at}.jpg`,
    }))
    const key = (path: string) => path.toLowerCase()
    expect(linearly((count) => swapping(many.slice(0, count), key), 40_000)).toBe(false)
    expect(
      swapping(
        [
          { from: '/a/x', to: '/a/y' },
          { from: '/a/Y', to: '/a/x' },
        ],
        key,
      ),
    ).toBe(true)
  })
})
