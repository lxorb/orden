import { describe, expect, test } from 'vitest'
import type { QueueRows } from './file-queue'
import {
  droppedWaiting,
  queuedRemoval,
  queuedUpload,
  settledWaiting,
  waitingFiles,
} from './file-queue'

function rows(): QueueRows & { kept: Map<string, unknown> } {
  const kept = new Map<string, unknown>()
  return {
    kept,
    read: (key) => Promise.resolve(kept.get(key)),
    keep: (key, value) => {
      if (value === null) kept.delete(key)
      else kept.set(key, value)
      return Promise.resolve()
    },
  }
}

describe('the files waiting to be sent', () => {
  test('hold an upload until it is settled', async () => {
    const at = rows()
    await queuedUpload(at, 'i', 'f', 2)
    const [one] = await waitingFiles(at)
    expect(one).toEqual({ item: 'i', file: 'f', parts: 2, gone: null })
    if (!one) throw new Error('none')
    await settledWaiting(at, one)
    expect(await waitingFiles(at)).toEqual([])
    expect(at.kept.size).toBe(0)
  })

  test('forget an upload never sent when its file is taken off', async () => {
    const at = rows()
    await queuedUpload(at, 'i', 'f', 1)
    await queuedRemoval(at, 'v', 'i', 'f')
    expect(await waitingFiles(at)).toEqual([])
  })

  test('ask the account to delete a file it already has', async () => {
    const at = rows()
    await queuedRemoval(at, 'v', 'i', 'f')
    expect(await waitingFiles(at)).toEqual([{ item: 'i', file: 'f', parts: 1, gone: 'v' }])
  })

  test('drop the uploads of items that are gone, but not their deletions', async () => {
    const at = rows()
    await queuedUpload(at, 'i', 'f', 1)
    await queuedRemoval(at, 'v', 'i', 'g')
    await queuedUpload(at, 'j', 'h', 1)
    await droppedWaiting(at, ['i'])
    expect(await waitingFiles(at)).toEqual([
      { item: 'i', file: 'g', parts: 1, gone: 'v' },
      { item: 'j', file: 'h', parts: 1, gone: null },
    ])
  })

  test('read nothing from a broken list', async () => {
    const at = rows()
    at.kept.set('files-waiting', [{ item: 3 }, 'x', { item: 'i', file: 'f', parts: 1, gone: null }])
    expect(await waitingFiles(at)).toEqual([{ item: 'i', file: 'f', parts: 1, gone: null }])
  })
})
