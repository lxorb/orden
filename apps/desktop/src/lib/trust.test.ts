import { describe, expect, test } from 'vitest'
import { originOf, pastesMarkup, type Provenance, trustsHtml } from './trust'

const alone: Provenance = { guest: false, pasted: false, shared: false, peers: false }
const from = (over: Partial<Provenance> = {}) => originOf({ ...alone, ...over })

describe('where a document came from', () => {
  test('is the reader own note, written here in a space nobody else is in', () => {
    expect(from()).toBe('own')
    expect(from({ peers: true })).toBe('own')
  })

  test('is the space, once somebody else can reach it', () => {
    expect(from({ shared: true })).toBe('space')
  })

  test('is the room, while somebody else is in the file', () => {
    expect(from({ shared: true, peers: true })).toBe('room')
  })

  test('is a paste, once markup has been put into it from outside', () => {
    expect(from({ pasted: true })).toBe('paste')
  })

  /** A guest session sees nothing it wrote: every space in it came down somebody
   *  else's link, and the words in them are that somebody's. */
  test('is a guest, whatever else is true of it', () => {
    expect(from({ guest: true })).toBe('guest')
    expect(from({ guest: true, shared: false })).toBe('guest')
  })

  /** A note in a shared space that has also been pasted into is doubtful for two
   *  reasons, and either is enough. */
  test('names the most doubtful of what it knows', () => {
    expect(from({ guest: true, pasted: true, shared: true, peers: true })).toBe('guest')
    expect(from({ pasted: true, shared: true, peers: true })).toBe('paste')
  })
})

describe('whose HTML is markup', () => {
  test('the reader own, which is what Typora does with a local document', () => {
    expect(trustsHtml('own')).toBe(true)
  })

  test.each(['guest', 'paste', 'room', 'space'] as const)('and nobody else: %s', (origin) => {
    expect(trustsHtml(origin)).toBe(false)
  })
})

describe('a paste that could have brought markup in', () => {
  test('is one the clipboard carried HTML for', () => {
    expect(pastesMarkup(['text/html', 'text/plain'], 'words')).toBe(true)
  })

  test('is one whose plain words hold a tag', () => {
    expect(pastesMarkup(['text/plain'], 'before <img src=x onerror=alert(1)> after')).toBe(true)
    expect(pastesMarkup(['text/plain'], '<script>alert(1)</script>')).toBe(true)
    expect(pastesMarkup(['text/plain'], '<br/>')).toBe(true)
    expect(pastesMarkup(['text/plain'], '<u>')).toBe(true)
  })

  test('is not ordinary words, or markdown, or arithmetic', () => {
    expect(pastesMarkup(['text/plain'], 'a plain paragraph')).toBe(false)
    expect(pastesMarkup(['text/plain'], '# A heading\n\n- one\n- two')).toBe(false)
    expect(pastesMarkup(['text/plain'], 'if a < b and c > d')).toBe(false)
    expect(pastesMarkup([], '')).toBe(false)
  })
})
