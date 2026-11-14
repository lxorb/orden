import { beforeEach, describe, expect, test, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  unreadable: new Set<string>(),
  kept: new Map<string, string>(),
  going: false,
  refusing: false,
  full: false,
}))

const PAD = '/app/scratchpad.md'

vi.mock('../platform/src/tauri', () => ({
  invoke: (command: string) =>
    command === 'scratchpad_path' ? Promise.resolve(PAD) : Promise.reject(new Error(command)),
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    noteText: (path: string) =>
      Promise.resolve(fake.unreadable.has(path) ? null : (fake.disk.get(path) ?? null)),
    documentAt: () => null,
  },
}))

vi.mock('../platform/src/on-disk', () => ({
  onDisk: (path: string) => Promise.resolve(fake.disk.has(path)),
}))

vi.mock('../platform/src/log', () => ({ log: () => undefined }))

vi.mock('../platform/src/stored', () => ({
  storedText: (key: string) => fake.kept.get(key) ?? null,
  stored: (key: string): unknown => JSON.parse(fake.kept.get(key) ?? 'null'),
  isRecord: (value: unknown) => typeof value === 'object' && value !== null,
  isString: (value: unknown) => typeof value === 'string',
  keep: (key: string, value: string) => {
    if (fake.full) return false
    fake.kept.set(key, value)
    return true
  },
  keepJson: (key: string, value: unknown) => {
    if (fake.full) return false
    fake.kept.set(key, JSON.stringify(value))
    return true
  },
  forget: (key: string) => fake.kept.delete(key),
}))

vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, words: string) => {
    if (fake.going) return new Promise(() => undefined)
    if (fake.refusing) return Promise.reject(new Error('read-only'))
    fake.disk.set(path, words)
    return Promise.resolve()
  },
}))

vi.mock('./is.svelte', () => ({ shown: { show: () => undefined } }))

const { scratchpad } = await import('./pad')

const launched = async () => {
  vi.resetModules()
  return (await import('./pad')).scratchpad
}

beforeEach(() => {
  fake.disk.clear()
  fake.unreadable.clear()
  fake.kept.clear()
  fake.going = false
  fake.refusing = false
  fake.full = false
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

describe('words the card is writing down', () => {
  const wentWriting = async (words: string) => {
    const pad = await launched()
    await pad.editable()
    fake.going = true
    void pad.writeDown(PAD, words)
    fake.going = false
  }

  test('are written by the next launch where the last one went before the disk had them', async () => {
    fake.disk.set(PAD, 'before')
    await wentWriting('before and after')

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('before and after')
    expect(fake.kept.size).toBe(0)
  })

  test('and are not held once the disk has them, so a later launch leaves the file alone', async () => {
    const pad = await launched()
    await pad.editable()
    await pad.writeDown(PAD, 'written')
    fake.disk.set(PAD, 'changed by another window')

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('changed by another window')
  })

  test('while a newer write still owed is not let go of by an older one landing', async () => {
    const pad = await launched()
    await pad.editable()
    const landing = pad.writeDown(PAD, 'older')
    fake.going = true
    void pad.writeDown(PAD, 'newer')
    fake.going = false
    await landing

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('newer')
  })

  test('leave the card its path and its words where the disk will still not take them', async () => {
    fake.disk.set(PAD, 'before')
    await wentWriting('before and after')
    fake.refusing = true

    const next = await launched()

    await expect(next.where()).resolves.toBe(PAD)
    await expect(next.editable()).resolves.toBe('before and after')
    expect(fake.disk.get(PAD)).toBe('before')
    expect(fake.kept.size).toBe(1)
  })

  test('are kept beside what an append wrote since, and write neither over the other', async () => {
    fake.disk.set(PAD, 'first')
    const pad = await launched()
    await pad.editable()
    fake.refusing = true
    await expect(pad.writeDown(PAD, 'first hello')).rejects.toThrow()
    fake.refusing = false

    await pad.append('world')
    await (await launched()).where()

    expect(fake.disk.get(PAD)).toContain('world')
    expect(fake.disk.get(PAD)).toContain('first hello')
  })

  test('are done with once a write with the card up has landed, which has them in it', async () => {
    fake.disk.set(PAD, 'first')
    const pad = await launched()
    await pad.editable()
    fake.refusing = true
    await expect(pad.writeDown(PAD, 'first hello')).rejects.toThrow()
    fake.refusing = false

    pad.live = {
      state: { doc: { toString: () => 'first hello' } },
      dispatch: () => undefined,
    } as unknown as NonNullable<typeof pad.live>
    await pad.append('world')
    fake.disk.set(PAD, 'changed by another window')
    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('changed by another window')
  })

  test('leave nothing stale behind where storage is too full to hold them', async () => {
    fake.disk.set(PAD, 'base')
    const pad = await launched()
    await pad.editable()
    fake.refusing = true
    await expect(pad.writeDown(PAD, 'older')).rejects.toThrow()
    fake.refusing = false
    fake.full = true
    fake.going = true
    void pad.writeDown(PAD, 'newer')
    fake.going = false
    fake.full = false
    fake.disk.set(PAD, 'newer')

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('newer')
  })

  test('keep what another program wrote to the file since, and go beside it', async () => {
    fake.disk.set(PAD, 'v0')
    await wentWriting('v1')
    fake.disk.set(PAD, 'v2')

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toContain('v2')
    expect(fake.disk.get(PAD)).toContain('v1')
    expect(fake.kept.size).toBe(0)
  })

  test('and are not said twice where the disk has them after all', async () => {
    fake.disk.set(PAD, 'v0')
    await wentWriting('v1')
    fake.disk.set(PAD, 'v1')

    await (await launched()).where()

    expect(fake.disk.get(PAD)).toBe('v1')
    expect(fake.kept.size).toBe(0)
  })
})

describe('words another device wrote', () => {
  test('are kept before the file is written, then land in it', async () => {
    fake.disk.set(PAD, 'mine')
    const seen: string[] = []

    await scratchpad.takeIn(
      (now) => [{ from: now.length, to: now.length, insert: ' theirs' }],
      (after) => {
        seen.push(after, fake.disk.get(PAD) ?? '')
        return Promise.resolve()
      },
    )

    expect(seen).toEqual(['mine theirs', 'mine'])
    expect(fake.disk.get(PAD)).toBe('mine theirs')
  })

  test('are not taken for writing on this device', async () => {
    fake.disk.set(PAD, 'mine')
    let told = 0
    const stop = scratchpad.listen(() => told++)

    await scratchpad.takeIn(
      () => [{ from: 0, to: 0, insert: 'theirs ' }],
      () => Promise.resolve(),
    )
    expect(told).toBe(0)

    await scratchpad.append('more')
    expect(told).toBe(1)
    stop()
  })
})
