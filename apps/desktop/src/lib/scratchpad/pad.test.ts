import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The scratchpad's writes, over a disk that is a map. What is here is the one thing
 *  a write must never do: empty the scratchpad because its file would not read. */

const fake = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  /** Files that are there and will not read: another encoding, or a lock. */
  unreadable: new Set<string>(),
  /** What a browser keeps through a reload. */
  kept: new Map<string, string>(),
  /** The page is going: a write begun now never lands. */
  going: false,
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

vi.mock('../stored', () => ({
  storedText: (key: string) => fake.kept.get(key) ?? null,
  keep: (key: string, value: string) => fake.kept.set(key, value),
  forget: (key: string) => fake.kept.delete(key),
}))

vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, words: string) => {
    if (fake.going) return new Promise(() => undefined)
    fake.disk.set(path, words)
    return Promise.resolve()
  },
}))

vi.mock('./is.svelte', () => ({ shown: { show: () => undefined } }))

const { scratchpad } = await import('./pad')

/** One launch: the path is asked once per run, and what is left of the last is read then. */
const launched = async () => {
  vi.resetModules()
  return (await import('./pad')).scratchpad
}

beforeEach(() => {
  fake.disk.clear()
  fake.unreadable.clear()
  fake.kept.clear()
  fake.going = false
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

/** A write begun as the page goes may never land: a browser does not wait for it, and
 *  WebKit lost the words of a reload made within the pause after the typing (#446). The
 *  scratchpad is in no session, so nothing else held them. */
describe('words the card is writing down', () => {
  test('are written by the next launch where the last one went before the disk had them', async () => {
    fake.disk.set(PAD, 'before')
    fake.going = true
    void scratchpad.writeDown(PAD, 'before and after')
    fake.going = false

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('before and after')
    expect(fake.kept.size).toBe(0)
  })

  test('and are not held once the disk has them, so a later launch leaves the file alone', async () => {
    await scratchpad.writeDown(PAD, 'written')
    fake.disk.set(PAD, 'changed by another window')

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('changed by another window')
  })

  test('while a newer write still owed is not let go of by an older one landing', async () => {
    const landing = scratchpad.writeDown(PAD, 'older')
    fake.going = true
    void scratchpad.writeDown(PAD, 'newer')
    fake.going = false
    await landing

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('newer')
  })
})
