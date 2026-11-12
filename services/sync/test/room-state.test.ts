import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { MAX_NOTE_BYTES } from '../src/sync-server/src/notes'
import {
  MOST_DOCUMENT_BYTES,
  RoomState,
  TOO_LARGE_IN_A_ROOM,
} from '../src/sync-server/src/rooms/state'
import { TEXT } from '@orden/rooms'

class Kept {
  readonly held = new Map<string, unknown>()

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.held.get(key) as T | undefined)
  }

  list<T>(options: { prefix: string }): Promise<Map<string, T>> {
    const found = new Map<string, T>()
    for (const [key, value] of this.held) {
      if (key.startsWith(options.prefix)) found.set(key, value as T)
    }
    return Promise.resolve(found)
  }

  put(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.held.set(key, value)
    return Promise.resolve()
  }

  delete(keys: string[]): Promise<unknown> {
    for (const key of keys) this.held.delete(key)
    return Promise.resolve(0)
  }

  keys(prefix: string): string[] {
    return [...this.held.keys()].filter((key) => key.startsWith(prefix)).sort()
  }
}

function update(bytes: number): Uint8Array {
  return new Uint8Array(bytes)
}

describe('how large a room’s document may get', () => {
  test('is twice the longest note, which is the one number the two share', () => {
    expect(MOST_DOCUMENT_BYTES).toBe(2 * MAX_NOTE_BYTES)
  })

  test('and a document under it takes what arrives', async () => {
    const state = new RoomState(new Kept())
    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, 'the words of a note')
    })

    expect(state.full()).toBe(false)
    await state.record(update(1024))
    expect(state.full()).toBe(false)
  })

  test('and a document at it refuses, in words', async () => {
    const kept = new Kept()
    const state = new RoomState(kept)

    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, 'x'.repeat(MOST_DOCUMENT_BYTES))
    })

    expect(state.full()).toBe(true)
    await expect(state.record(update(64))).rejects.toThrow(TOO_LARGE_IN_A_ROOM)
  })

  test('and stays a room that opens, however many pieces it is stored in', async () => {
    const kept = new Kept()
    const state = new RoomState(kept)
    const words = 'x'.repeat(MOST_DOCUMENT_BYTES)

    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, words)
    })

    expect(kept.keys('state:').length).toBeGreaterThan(60)

    const again = new RoomState(kept)
    expect(await again.load()).toBe(true)
    expect(again.doc.getText(TEXT).toJSON()).toBe(words)
    expect(again.full()).toBe(true)
  })
})

describe('the pieces a room is stored in', () => {
  test('go back together in the order they were written, not in the order they sort', async () => {
    const doc = new Y.Doc()
    doc
      .getText(TEXT)
      .insert(0, 'a note long enough to be written down in a dozen pieces '.repeat(40))
    const whole = Y.encodeStateAsUpdateV2(doc)

    const kept = new Kept()
    const size = Math.ceil(whole.length / 12)
    for (let at = 0; at * size < whole.length; at++) {
      await kept.put({ [`state:${at}`]: whole.slice(at * size, (at + 1) * size) })
    }
    expect(kept.keys('state:').length).toBe(12)

    const state = new RoomState(kept)
    expect(await state.load()).toBe(true)
    expect(state.doc.getText(TEXT).toJSON()).toBe(doc.getText(TEXT).toJSON())
  })

  test('and are written six digits wide', async () => {
    const kept = new Kept()
    const state = new RoomState(kept)
    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, 'one small note')
    })

    expect(kept.keys('state:')).toEqual(['state:000000'])
  })
})
