import { describe, expect, test } from 'vitest'
import { type Clip, readAnswer, readAsk, readClip, readReading } from './messages'

const CLIP: Clip = {
  origin: { kind: 'page', url: 'https://site.example/a', title: 'A', tags: ['x'] },
  clipped: '2026-03-04T09:12:00.000Z',
  markdown: 'body',
  images: ['https://site.example/x.png'],
}

describe('a clip arriving from the page', () => {
  test('is what it says it is', () => {
    expect(readClip(CLIP)).toEqual(CLIP)
  })

  test('is nothing when it is not an object', () => {
    expect(readClip(null)).toBe(null)
    expect(readClip('a clip')).toBe(null)
    expect(readClip([CLIP])).toBe(null)
  })

  test('is nothing when the kind is not one of the three', () => {
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, kind: 'everything' } })).toBe(null)
  })

  test('is nothing without the fields the note needs', () => {
    expect(readClip({ ...CLIP, markdown: undefined })).toBe(null)
    expect(readClip({ ...CLIP, clipped: 7 })).toBe(null)
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, url: null } })).toBe(null)
  })

  test('keeps the tags it can read and drops the rest', () => {
    expect(
      readClip({ ...CLIP, origin: { ...CLIP.origin, tags: ['a', 3, null, 'b'] } })?.origin.tags,
    ).toEqual(['a', 'b'])
  })

  test('has no tags when the tags are not a list', () => {
    expect(readClip({ ...CLIP, origin: { ...CLIP.origin, tags: 'a,b' } })?.origin.tags).toEqual([])
  })
})

describe('what the worker is asked', () => {
  test('reads a request to clip', () => {
    expect(readAsk({ ask: 'clip', kind: 'selection' })).toEqual({ ask: 'clip', kind: 'selection' })
  })

  test('reads a request to save', () => {
    expect(readAsk({ ask: 'save', clip: CLIP, spaceId: 's1', folder: 'Reading' })).toEqual({
      ask: 'save',
      clip: CLIP,
      spaceId: 's1',
      folder: 'Reading',
    })
  })

  test('refuses a save with no clip in it', () => {
    expect(readAsk({ ask: 'save', spaceId: 's1', folder: '' })).toBe(null)
  })

  test('refuses a save that names no space', () => {
    expect(readAsk({ ask: 'save', clip: CLIP, folder: '' })).toBe(null)
  })

  test('refuses anything it was not asked', () => {
    expect(readAsk({ ask: 'delete' })).toBe(null)
    expect(readAsk({})).toBe(null)
    expect(readAsk(undefined)).toBe(null)
  })
})

describe('what the page is asked', () => {
  test('reads a reading with a link on it', () => {
    expect(readReading({ read: 'link', link: 'https://a.example' })).toEqual({
      read: 'link',
      link: 'https://a.example',
    })
  })

  test('reads one without', () => {
    expect(readReading({ read: 'page' })).toEqual({ read: 'page', link: null })
  })

  test('refuses a kind that is not one of the three', () => {
    expect(readReading({ read: 'everything' })).toBe(null)
  })
})

describe('what comes back', () => {
  test('a sentence saying why not', () => {
    expect(readAnswer({ problem: 'Sign in to Nib first.' })).toEqual({
      problem: 'Sign in to Nib first.',
    })
  })

  test('the path a note landed at', () => {
    expect(readAnswer({ path: 'Reading/A.md' })).toEqual({ path: 'Reading/A.md' })
  })

  test('a clip', () => {
    expect(readAnswer({ clip: CLIP })).toEqual({ clip: CLIP })
  })

  test('nothing recognisable at all', () => {
    expect(readAnswer({ ok: true })).toBe(null)
    expect(readAnswer(null)).toBe(null)
  })
})
