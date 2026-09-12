import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
} satisfies Storage)
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { linkTo } = await import('./link')
const { readUri } = await import('./uri')

describe('a link to a note', () => {
  test('says the space and the path', () => {
    expect(linkTo('Work', 'notes/Plan.md')).toBe('nib://open?space=Work&path=notes%2FPlan.md')
  })

  test('carries the heading when there is one', () => {
    expect(linkTo('Work', 'Plan.md', 'Later this week')).toBe(
      'nib://open?space=Work&path=Plan.md&heading=Later+this+week',
    )
  })

  test('leaves the heading off when the caret is above them all', () => {
    expect(linkTo('Work', 'Plan.md', null)).not.toContain('heading')
  })

  /** The two halves have to agree, so the link the app writes is read back here
   *  rather than only looked at. A space with a space in its name and a folder with
   *  an ampersand are exactly what a hand-written link gets wrong. */
  test('reads back as what it was written from', () => {
    const link = readUri(linkTo('Day job', 'reading & notes/Plan B.md', 'Q&A'))

    expect(link?.action).toBe('open')
    expect(link?.args).toEqual({
      space: 'Day job',
      path: 'reading & notes/Plan B.md',
      heading: 'Q&A',
    })
  })
})
