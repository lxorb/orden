import { describe, expect, test } from 'vitest'
import { syncDeletes } from './deletes'

describe('what sync takes off this disk', () => {
  test('goes outright where the account keeps it: a note, a canvas, a web note', () => {
    expect(syncDeletes('/s/Notes/2026-10-24.md', 'file')).toBe(true)
    expect(syncDeletes('/s/Notes/Board.canvas', 'file')).toBe(true)
    expect(syncDeletes('/s/Notes/Docs.url', 'file')).toBe(true)
  })

  test('goes to this device’s trash where the account does not keep it', () => {
    expect(syncDeletes('/s/Notes/Lecture.pages', 'file')).toBe(false)
    expect(syncDeletes('/s/Notes/photo.png', 'file')).toBe(false)
    expect(syncDeletes('/s/Notes/Paper.pdf', 'file')).toBe(false)
    expect(syncDeletes('/s/Notes/Journal', 'folder')).toBe(false)
  })
})
