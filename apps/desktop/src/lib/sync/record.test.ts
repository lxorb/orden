import { conflictPath } from '@orden/markdown/paths'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Clash } from './conflicts'

const KEY = 'nib:sync-log'

const spaces = [{ root: '/Work' }]

const reloaded: { path: string; content: string }[] = []

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces,
    reload: (path: string, content: string) => void reloaded.push({ path, content }),
  },
}))

const invoked: { command: string; path: string }[] = []

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    invoked.push({ command, path: String(args.path) })
    return Promise.resolve(command === 'read_note' ? 'what is here' : undefined)
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isNative: false,
}))

const { record } = await import('./record.svelte')

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

function aClash(path: string): Clash {
  return { path, id: 'note-id', version: 2, theirs: 'what the other device wrote', at: 1 }
}

function stored(): string {
  return localStorage.getItem(KEY) ?? ''
}

beforeEach(() => {
  localStorage.clear()
  invoked.length = 0
  reloaded.length = 0
  record.restore()
})

function held(clashes: Clash[]) {
  localStorage.setItem(KEY, JSON.stringify({ passes: [], clashes }))
  record.restore()
}

describe('the log', () => {
  test('keeps a pass that moved something and skips one that moved nothing', () => {
    record.wrote({ at: 1, space: 'Work', pulled: 0, pushed: 0, clashed: 0, failed: null })
    expect(record.passes).toHaveLength(0)

    record.wrote({ at: 2, space: 'Work', pulled: 3, pushed: 0, clashed: 0, failed: null })
    expect(record.passes).toHaveLength(1)
  })

  test('and clearing it leaves what is still waiting to be answered', () => {
    record.clash(aClash('Plan.md'))
    record.wrote({ at: 2, space: 'Work', pulled: 3, pushed: 0, clashed: 0, failed: null })

    record.clear()

    expect(record.passes).toHaveLength(0)
    expect(record.clashes).toHaveLength(1)
  })
})

describe('a path read back out of storage', () => {
  test('is settled when a space holds it', async () => {
    held([aClash('/Work/Plan.md')])

    await record.settle(record.clashes[0]!, 'theirs')

    expect(invoked).toEqual([
      { command: 'read_note', path: '/Work/Plan.md' },
      { command: 'snapshot_note', path: '/Work/Plan.md' },
      { command: 'write_note', path: '/Work/Plan.md' },
    ])
    expect(record.clashes).toHaveLength(0)
  })

  test('and the note on screen becomes the copy that was chosen', async () => {
    held([aClash('/Work/Plan.md')])

    await record.settle(record.clashes[0]!, 'theirs')

    expect(reloaded).toEqual([{ path: '/Work/Plan.md', content: 'what the other device wrote' }])
  })

  test('and touches nothing when no space does', async () => {
    held([aClash('/Users/me/Downloads/theirs.md')])

    await record.settle(record.clashes[0]!, 'theirs')

    expect(invoked).toEqual([])
    expect(record.clashes).toHaveLength(0)
  })

  test('nor when it climbs back out of the space it names', async () => {
    held([aClash('/Work/../../etc/passwd')])

    await record.settle(record.clashes[0]!, 'both')

    expect(invoked).toEqual([])
    expect(record.clashes).toHaveLength(0)
  })
})

describe('a note waiting to be settled', () => {
  const moved = (from: string, to: string, kind: 'file' | 'folder' = 'file') =>
    record.follow({ op: 'moved', from, to, kind, root: '/Work' })

  test('is held under its new name once it is renamed', () => {
    held([aClash('/Work/Plan.md')])

    moved('/Work/Plan.md', '/Work/Goals.md')

    expect(record.clashes.map((one) => one.path)).toEqual(['/Work/Goals.md'])
    expect(record.held).toEqual(new Set(['/Work/Goals.md']))
  })

  test('and goes with the folder it is in', () => {
    held([aClash('/Work/Old/Plan.md'), aClash('/Work/Oldish.md')])

    moved('/Work/Old', '/Work/New', 'folder')

    expect(record.clashes.map((one) => one.path)).toEqual(['/Work/New/Plan.md', '/Work/Oldish.md'])
  })

  test('and is let go of when its note is deleted here', () => {
    held([aClash('/Work/Plan.md')])

    record.follow({ op: 'removed', path: '/Work/Plan.md', kind: 'file', root: '/Work' })

    expect(record.clashes).toEqual([])
  })

  test('is settled where its note is now, found by its id', async () => {
    held([aClash('/Work/Plan.md')])
    record.notes = { at: () => '/Work/Goals.md', of: () => 'another-id' }

    await record.settle(record.clashes[0]!, 'theirs')
    record.notes = null

    expect(invoked.map((one) => one.path)).not.toContain('/Work/Plan.md')
    expect(invoked).toContainEqual({ command: 'write_note', path: '/Work/Goals.md' })
  })

  test('is settled where it followed its file when the record is behind', async () => {
    held([aClash('/Work/Goals.md')])
    const told: string[] = []
    record.notes = {
      at: () => '/Work/Plan.md',
      of: () => null,
      moved: (from, to) => void told.push(`${from} ${to}`),
    }

    await record.settle(record.clashes[0]!, 'theirs')
    record.notes = null

    expect(invoked).toContainEqual({ command: 'write_note', path: '/Work/Goals.md' })
    expect(invoked).not.toContainEqual({ command: 'write_note', path: '/Work/Plan.md' })
    expect(told).toEqual(['/Work/Plan.md /Work/Goals.md'])
  })

  test('never writes over another note that has its old name by now', async () => {
    held([aClash('/Work/Plan.md')])
    record.notes = { at: () => null, of: () => 'another-id' }

    await record.settle(record.clashes[0]!, 'theirs')
    record.notes = null

    expect(invoked).not.toContainEqual({ command: 'write_note', path: '/Work/Plan.md' })
    expect(invoked).toContainEqual({ command: 'write_note', path: conflictPath('/Work/Plan.md') })
    expect(record.clashes).toEqual([])
  })
})

describe('keeping both', () => {
  test('keeps what was already at the second copy’s name as a version', async () => {
    held([aClash('/Work/Plan.md')])

    await record.settle(record.clashes[0]!, 'both')

    const copy = conflictPath('/Work/Plan.md')
    expect(invoked).toEqual([
      { command: 'read_note', path: copy },
      { command: 'snapshot_note', path: copy },
      { command: 'write_note', path: copy },
    ])
  })
})

describe('a note asked about again', () => {
  test('holds the newest of the other copy', () => {
    record.clash(aClash('/Work/Plan.md'))
    record.clash({ ...aClash('/Work/Plan.md'), version: 3, theirs: 'and more', at: 2 })

    expect(record.clashes).toEqual([
      { ...aClash('/Work/Plan.md'), version: 3, theirs: 'and more', at: 2 },
    ])
  })

  test('and is the same question under another name', () => {
    record.clash(aClash('/Work/Plan.md'))
    record.clash({ ...aClash('/Work/Goals.md'), version: 3, theirs: 'and more' })

    expect(record.clashes.map((one) => [one.path, one.theirs])).toEqual([
      ['/Work/Goals.md', 'and more'],
    ])
  })
})

describe('signing out', () => {
  test('takes the other device’s words off this one', () => {
    record.clash(aClash('Plan.md'))
    expect(stored()).toContain('what the other device wrote')

    record.forgetEverything()

    expect(record.clashes).toHaveLength(0)
    expect(record.passes).toHaveLength(0)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
