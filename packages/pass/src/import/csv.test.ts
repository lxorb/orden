import { describe, expect, it } from 'vitest'
import { csvHeader, csvRecords, csvRows, csvText } from './csv'

describe('csvRows', () => {
  it('reads the RFC 4180 examples', () => {
    expect(csvRows('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n')).toEqual([
      ['aaa', 'bbb', 'ccc'],
      ['zzz', 'yyy', 'xxx'],
    ])
    expect(csvRows('aaa,bbb,ccc\r\nzzz,yyy,xxx')).toEqual([
      ['aaa', 'bbb', 'ccc'],
      ['zzz', 'yyy', 'xxx'],
    ])
    expect(csvRows('"aaa","b\r\nbb","ccc"\r\nzzz,yyy,xxx')).toEqual([
      ['aaa', 'b\r\nbb', 'ccc'],
      ['zzz', 'yyy', 'xxx'],
    ])
    expect(csvRows('"aaa","b""bb","ccc"')).toEqual([['aaa', 'b"bb', 'ccc']])
  })

  it('keeps empty cells, LF line ends, a BOM and non-ASCII', () => {
    expect(csvRows('﻿a,,c\n,"",\nü,日本,😀\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['ü', '日本', '😀'],
    ])
  })

  it('skips blank lines', () => {
    expect(csvRows('a,b\n\n\r\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps a quote inside an unquoted cell', () => {
    expect(csvRows('a"b,c')).toEqual([['a"b', 'c']])
  })

  it('reads a quoted newline in the last cell', () => {
    expect(csvRows('a,"line 1\nline 2"')).toEqual([['a', 'line 1\nline 2']])
  })
})

describe('csvRecords', () => {
  it('maps the header onto each row', () => {
    expect(csvRecords('name, url\nx,https://a\ny')).toEqual([
      { name: 'x', url: 'https://a' },
      { name: 'y', url: '' },
    ])
  })

  it('is empty for an empty file', () => {
    expect(csvRecords('')).toEqual([])
    expect(csvHeader('')).toEqual([])
  })
})

describe('csvText', () => {
  it('quotes what needs it and reads back the same', () => {
    const rows = [
      ['name', 'note'],
      ['a, b', 'say "hi"\nbye'],
      [' lead', 'plain'],
    ]
    const text = csvText(rows)
    expect(text).toBe('name,note\r\n"a, b","say ""hi""\nbye"\r\n" lead",plain\r\n')
    expect(csvRows(text)).toEqual(rows)
  })
})
