import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The scratchpad's writes, over a disk that is a map. What is here is the one thing
 *  a write must never do: empty the scratchpad because its file would not read. */

const fake = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  /** Files that are there and will not read: another encoding, or a lock. */
  unreadable: new Set<string>(),
}))

const PAD = '/app/scratchpad.md'

vi.mock('../tauri', () => ({
  invoke: (command: string) =>
    command === 'scratchpad_path' ? Promise.resolve(PAD) : Promise.reject(new Error(command)),
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    noteText: (path: string) =>
      Promise.resolve(fake.unreadable.has(path) ? null : (fake.disk.get(path) ?? null)),
  },
}))

vi.mock('../on-disk', () => ({
  onDisk: (path: string) => Promise.resolve(fake.disk.has(path)),
}))

vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, words: string) => {
    fake.disk.set(path, words)
    return Promise.resolve()
  },
}))

vi.mock('./is.svelte', () => ({ shown: { show: () => undefined } }))

const { scratchpad } = await import('./pad')

beforeEach(() => {
  fake.disk.clear()
  fake.unreadable.clear()
})

describe('words put on the end of the scratchpad', () => {
  test('go after what it says', async () => {
    fake.disk.set(PAD, 'first')
    await scratchpad.append('second')

    expect(fake.disk.get(PAD)).toContain('first')
    expect(fake.disk.get(PAD)).toContain('second')
  })

  test('and start it where there is none yet', async () => {
    await scratchpad.append('first')

    expect(fake.disk.get(PAD)).toContain('first')
  })

  /** A file that is there and will not read used to read as an empty scratchpad, and
   *  the words appended to that were written over everything it held. */
  test('and are refused where it is there and will not read', async () => {
    fake.disk.set(PAD, 'a year of notes')
    fake.unreadable.add(PAD)

    await expect(scratchpad.append('second')).rejects.toThrow()
    expect(fake.disk.get(PAD)).toBe('a year of notes')
  })

  test('as an edit is', async () => {
    fake.disk.set(PAD, 'a year of notes')
    fake.unreadable.add(PAD)

    await expect(scratchpad.replace('', [{ from: 0, to: 0, insert: 'x' }])).rejects.toThrow()
    expect(fake.disk.get(PAD)).toBe('a year of notes')
  })
})
