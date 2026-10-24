import { beforeEach, describe, expect, test, vi } from 'vitest'
import { sha256 } from '../bytes'

/** Whether the account holds what a path is on this disk, under sync v2: what a delete
 *  leans on to go outright rather than into this device's trash. Having been handed the
 *  file once is not enough. An edit made since the last push, a replacement the account
 *  has not taken yet, and a file held in a conflict are bytes only this disk has, and
 *  deleted outright they were gone, with only the older copy in Recently deleted. */

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { runner } = await import('./runner.svelte')

/** What is on the disk, by full path. */
const disk = new Map<string, string>()

interface Entry {
  id: string
  kind: string
  seq: number | null
  deleted: boolean
  written_hash: string | null
  file_key: string | null
  size: number | null
}

const entries = new Map<string, Entry>()
const held = new Set<string>()
const pending = new Set<string>()
const touched = new Set<string>()

/** An engine as far as the question reads one: an entry by path, and the core's word on
 *  whether it is held, has edits not sent, or was changed by another program. */
function engine() {
  const bytes = (path: string) => {
    const words = disk.get(path)
    return words === undefined ? null : new TextEncoder().encode(words)
  }
  return {
    entryAt: (path: string) => entries.get(path) ?? null,
    core: {
      isHeld: (id: string) => held.has(id),
      hasPending: (id: string) => pending.has(id),
      touched,
      world: {
        disk: { read: (path: string) => Promise.resolve(disk.get(path) ?? null) },
        digest: (text: string) => sha256(text),
        blobs: {
          read: (path: string) => Promise.resolve(bytes(path)),
          hash: (one: Uint8Array) => sha256(one),
        },
      },
    },
  }
}

/** A file the last pass left in step with the account: the bytes it has are the bytes
 *  this disk had. */
async function inStep(path: string, kind: string, words: string) {
  disk.set(path, words)
  const hash = await sha256(words)
  entries.set(path, {
    id: path,
    kind,
    seq: 1,
    deleted: false,
    written_hash: hash,
    file_key: kind === 'file' ? hash : null,
    size: words.length,
  })
}

beforeEach(() => {
  for (const one of [disk, entries, held, pending, touched]) one.clear()
  Object.assign(runner, { engine: engine() })
})

describe('a paper', () => {
  test('in step with the account is held', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')

    expect(await runner.holds('/Notes/paper.pdf')).toBe(true)
  })

  test('replaced here since the last push is not', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')
    disk.set('/Notes/paper.pdf', '%PDF highlighted offline')

    expect(await runner.holds('/Notes/paper.pdf')).toBe(false)
  })

  test('that another program changed, and the next pass has not read, is not', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')
    touched.add('/Notes/paper.pdf')

    expect(await runner.holds('/Notes/paper.pdf')).toBe(false)
  })

  test('whose replacement the account has not taken yet is not', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')
    const entry = entries.get('/Notes/paper.pdf')!
    entry.file_key = 'the bytes another device put up'

    expect(await runner.holds('/Notes/paper.pdf')).toBe(false)
  })

  test('held in a conflict is not: this side was never sent', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')
    held.add('/Notes/paper.pdf')

    expect(await runner.holds('/Notes/paper.pdf')).toBe(false)
  })

  test('never handed to the account is not', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')
    entries.get('/Notes/paper.pdf')!.seq = null

    expect(await runner.holds('/Notes/paper.pdf')).toBe(false)
  })

  test('larger than what a folder check may still read is not, and is not read', async () => {
    await inStep('/Notes/paper.pdf', 'file', '%PDF')
    const budget = { left: 2 }

    expect(await runner.holds('/Notes/paper.pdf', { budget })).toBe(false)
    expect(budget.left).toBe(2)
  })
})

describe('a note', () => {
  test('in step with the account is held', async () => {
    await inStep('/Notes/a.md', 'note', '# a')

    expect(await runner.holds('/Notes/a.md')).toBe(true)
  })

  test('with words the account has not acknowledged is not', async () => {
    await inStep('/Notes/a.md', 'note', '# a')
    pending.add('/Notes/a.md')

    expect(await runner.holds('/Notes/a.md')).toBe(false)
  })

  test('written by another program since nib last wrote it is not', async () => {
    await inStep('/Notes/a.md', 'note', '# a')
    disk.set('/Notes/a.md', '# a\nadded in another editor')

    expect(await runner.holds('/Notes/a.md')).toBe(false)
  })

  test('held in a conflict is not', async () => {
    await inStep('/Notes/a.md', 'note', '# a')
    held.add('/Notes/a.md')

    expect(await runner.holds('/Notes/a.md')).toBe(false)
  })
})
