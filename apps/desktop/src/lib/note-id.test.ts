import { describe, expect, test } from 'vitest'
import { DEFAULT_ID_FORMAT, ID_FORMATS, noteId } from './note-id'

/** A fixed moment, so the assertions read the same in every timezone: the
 *  formats spell local time, which is what somebody naming a note means by it. */
const AT = new Date(2026, 8, 7, 4, 5, 6)

describe('the name a unique note gets', () => {
  test('the default is the moment as one number, to the minute', () => {
    expect(noteId(DEFAULT_ID_FORMAT, AT)).toBe('202609070405')
  })

  test('every offered format is filled in', () => {
    expect(ID_FORMATS.map((format) => noteId(format, AT))).toEqual([
      '202609070405',
      '20260907040506',
      '2026-09-07 0405',
      '20260907',
    ])
  })

  test('single digits are padded, so the name reads as one number', () => {
    expect(noteId('YYYYMMDDHHmmss', new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102030405')
  })

  test('anything that is not a token is kept as written', () => {
    expect(noteId('YYYY-MM-DD note HH', AT)).toBe('2026-09-07 note 04')
  })

  test('a format with no token in it would name every note the same, so it is not used', () => {
    expect(noteId('note', AT)).toBe('202609070405')
    expect(noteId('', AT)).toBe('202609070405')
  })

  test('the longest token wins, so a year is a year', () => {
    expect(noteId('YYYY', AT)).toBe('2026')
  })

  test('the default is the first of the formats offered', () => {
    expect(ID_FORMATS[0]).toBe(DEFAULT_ID_FORMAT)
  })
})
