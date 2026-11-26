import { describe, expect, test } from 'vitest'
import { assetFolder } from './attachments'

const SPACE = '/Notes'
describe("the space's assets folder, where every pasted or dropped file goes", () => {
  test('is named plainly for a note at the top of the space', () => {
    expect(assetFolder('/Notes/Read me.md', SPACE)).toBe('assets')
  })
  test('is reached from wherever in the space the note sits', () => {
    expect(assetFolder('/Notes/Work/Plan.md', SPACE)).toBe('../assets')
    expect(assetFolder('/Notes/Work/2026/Q1.md', SPACE)).toBe('../../assets')
  })
  test('is worked out the same from a path a platform writes with backslashes', () => {
    expect(assetFolder(String.raw`C:\Orden\Notes\Work\Plan.md`, String.raw`C:\Orden\Notes`)).toBe('../assets')
  })
  test('falls back to one beside a note that is in no space at all', () => {
    expect(assetFolder('/elsewhere/Notes.md', SPACE)).toBe('assets')
    expect(assetFolder('/elsewhere/Notes.md', null)).toBe('assets')
  })
  test('is not claimed by a space that merely starts the same way', () => {
    expect(assetFolder('/Notebook/a.md', SPACE)).toBe('assets')
  })
})
