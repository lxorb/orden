import { blank, newEnvelope } from '@orden/pass/envelope'
import type { Envelope, Login } from '@orden/pass/types'
import { describe, expect, test } from 'vitest'
import { mergedEnvelope, mergedFields } from './merge'

function login(more: Partial<Login> = {}): Login {
  return { ...blank('login'), title: 'Bank', ...more }
}

function envelope(content: Login, modified: number, more: Partial<Envelope> = {}): Envelope {
  return { ...newEnvelope(content, 1), modified, ...more }
}

const base = envelope(login({ username: 'ada', password: 'one' }), 10)

describe('merging two edits of one item', () => {
  test('keeps both when each changed a different field', () => {
    const mine = envelope(login({ username: 'ada', password: 'two' }), 20)
    const theirs = envelope(login({ username: 'lovelace', password: 'one' }), 30)
    const merged = mergedEnvelope(base, mine, theirs)
    expect(merged.envelope.content).toMatchObject({ username: 'lovelace', password: 'two' })
    expect(merged.envelope.modified).toBe(30)
    expect(merged.lost).toBeNull()
  })

  test('gives one field to the newer edit and keeps the older as lost', () => {
    const mine = envelope(login({ username: 'ada', password: 'mine' }), 40)
    const theirs = envelope(login({ username: 'ada', password: 'theirs' }), 30)
    const merged = mergedEnvelope(base, mine, theirs)
    expect(merged.envelope.content).toMatchObject({ password: 'mine' })
    expect(merged.lost).toBe('theirs')

    const older = mergedEnvelope(base, { ...mine, modified: 20 }, theirs)
    expect(older.envelope.content).toMatchObject({ password: 'theirs' })
    expect(older.lost).toBe('mine')
  })

  test('takes the pin, the folder, the trash and the watch each from the side that changed it', () => {
    const mine = { ...base, pinned: true, folder: 'f1', modified: 20 }
    const theirs = { ...base, trashed: 99, monitored: false, modified: 15 }
    const merged = mergedEnvelope(base, mine, theirs)
    expect(merged.envelope).toMatchObject({
      pinned: true,
      folder: 'f1',
      trashed: 99,
      monitored: false,
    })
    expect(merged.lost).toBeNull()
  })

  test('meets extra fields by their ids', () => {
    const field = (id: string, value: string) => ({ id, name: id, kind: 'text' as const, value })
    const was = envelope(login({ fields: [field('a', '1')] }), 10)
    const mine = envelope(login({ fields: [field('a', '1'), field('b', '2')] }), 20)
    const theirs = envelope(login({ fields: [field('a', 'changed'), field('c', '3')] }), 30)
    const merged = mergedEnvelope(was, mine, theirs)
    expect((merged.envelope.content as Login).fields).toEqual([
      field('a', 'changed'),
      field('b', '2'),
      field('c', '3'),
    ])
    expect(merged.lost).toBeNull()
  })

  test('drops a field one side removed when the other left it alone', () => {
    const field = { id: 'a', name: 'PIN', kind: 'hidden' as const, value: '1234' }
    const was = envelope(login({ fields: [field] }), 10)
    const mine = envelope(login({ fields: [] }), 20)
    const theirs = envelope(login({ fields: [field], note: 'hi' }), 30)
    const merged = mergedEnvelope(was, mine, theirs)
    expect(merged.envelope.content).toMatchObject({ fields: [], note: 'hi' })
  })

  test('without a base, the newer side wins every field that differs and the other is kept', () => {
    const mine = envelope(login({ password: 'a' }), 20)
    const theirs = envelope(login({ password: 'b', note: 'x' }), 30)
    const merged = mergedEnvelope(null, mine, theirs)
    expect(merged.envelope.content).toMatchObject({ password: 'b', note: 'x' })
    expect(merged.lost).toBe('mine')
  })

  test('loses nothing when both made the same change', () => {
    const mine = envelope(login({ password: 'same' }), 20)
    const theirs = envelope(login({ password: 'same' }), 30)
    expect(mergedEnvelope(base, mine, theirs).lost).toBeNull()
  })

  test('takes the whole newer item when the kinds differ', () => {
    const note = { ...newEnvelope({ ...blank('note'), title: 'Bank' }, 1), modified: 50 }
    const mine = envelope(login({ password: 'x' }), 20)
    const merged = mergedEnvelope(base, mine, note)
    expect(merged.envelope.content.kind).toBe('note')
    expect(merged.lost).toBe('mine')
  })

  test('keeps the later use and the earlier creation', () => {
    const mine = { ...base, used: 5, created: 3 }
    const theirs = { ...base, used: 9, created: 1 }
    const merged = mergedEnvelope(base, mine, theirs).envelope
    expect(merged.used).toBe(9)
    expect(merged.created).toBe(1)
  })
})

describe('merging two edits of one vault', () => {
  test('keeps a new name and a new folder from either side', () => {
    const was = { name: 'Home', color: 'purple', folders: [{ id: 'a', name: 'A', parent: null }] }
    const mine = { ...was, name: 'House' }
    const theirs = { ...was, folders: [...was.folders, { id: 'b', name: 'B', parent: null }] }
    expect(mergedFields(was, mine, theirs)).toEqual({
      name: 'House',
      color: 'purple',
      folders: [
        { id: 'a', name: 'A', parent: null },
        { id: 'b', name: 'B', parent: null },
      ],
    })
  })
})
