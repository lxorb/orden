/** One note open in two windows, with real documents and one disk: H2-DESKTOP-14. */

import { describe, expect, test, vi } from 'vitest'
import { Windows } from '../windows'
import { NoteDoc } from './documents.svelte'
import { Across, type Desk } from './across'
import type { FileOp } from './file-ops'

vi.mock('../log', () => ({ log: vi.fn() }))

/** Two windows' ends of one channel. Delivery is held until `deliver`, which is a window
 *  that has not heard yet; `at once` is one that has. */
function channel() {
  const ends: { onmessage: ((event: MessageEvent<unknown>) => void) | null }[] = []
  const flight: (() => void)[] = []
  const end = () => {
    const line = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage: (message: unknown) => {
        for (const one of ends) {
          if (one !== line) {
            flight.push(() => one.onmessage?.({ data: message } as MessageEvent<unknown>))
          }
        }
      },
    }
    ends.push(line)
    return line
  }
  return {
    end,
    deliver: async () => {
      while (flight.length) {
        flight.shift()?.()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    },
  }
}

const PATH = '/Notes/Both.md'

function aWindow(line: ReturnType<ReturnType<typeof channel>['end']>, disk: Map<string, string>) {
  const documents: NoteDoc[] = []
  const heard: FileOp[] = []
  const owed: NoteDoc[] = []
  const versions: string[] = []
  const desk: Desk = {
    documents,
    tell: async (op) => {
      heard.push(op)
      if (op.op === 'removed')
        documents.splice(0, documents.length, ...documents.filter((n) => n.path))
    },
    follow: () => undefined,
    loadTree: async () => undefined,
    loadSpaces: async () => undefined,
    owed: (note) => owed.push(note),
    draftOf: (note) => {
      note.path = null
      note.onDisk = null
      note.dirty = true
    },
    joined: () => null,
    noteSaved: () => undefined,
    read: async (path) => disk.get(path) ?? null,
    exists: async (path) => disk.has(path),
    keepVersion: async (_path, text) => void versions.push(text),
  }
  const windows = new Windows(() => line)
  const across = new Across(desk, windows)
  const open = (text: string, kind: NoteDoc['kind'] = 'note') => {
    const note = new NoteDoc(
      { kind, path: PATH, name: 'Both.md', text, dirty: false },
      () => undefined,
    )
    documents.push(note)
    return note
  }
  /** What autosave does. */
  const save = async (note: NoteDoc) => {
    const path = note.path
    if (path === null) return null
    const content = note.latest
    const words = await across.writing(note, path, content, async (down) => {
      disk.set(path, down)
    })
    if (words !== null) note.dirty = note.latest !== words
    return words
  }
  const type = (note: NoteDoc, words: string) => {
    note.live.edit([{ from: note.live.text.length, to: note.live.text.length, insert: words }])
    note.dirty = true
  }
  return { across, windows, open, save, type, heard, owed, versions, documents }
}

const BASE = '# Both\n\nbase line\n'

function twoWindows(text = BASE) {
  const wires = channel()
  const disk = new Map([[PATH, text]])
  const a = aWindow(wires.end(), disk)
  const b = aWindow(wires.end(), disk)
  const deliver = async () => {
    await wires.deliver()
    await Promise.all([a.across.heardSoFar(), b.across.heardSoFar()])
    await wires.deliver()
    await Promise.all([a.across.heardSoFar(), b.across.heardSoFar()])
  }
  return { wires: { deliver }, disk, a, b }
}

describe('one note in two windows', () => {
  test('what one writes reaches the other, which stays clean', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    a.type(inA, 'FROM-A ')
    await a.save(inA)
    await wires.deliver()

    expect(disk.get(PATH)).toBe(`${BASE}FROM-A `)
    expect(inB.latest).toBe(`${BASE}FROM-A `)
    expect(inB.dirty).toBe(false)
    expect(b.owed).toEqual([])
  })

  test('a write that has not heard the last one keeps both, and no word goes', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    a.type(inA, 'FROM-A ')
    await a.save(inA)
    // B has heard nothing, and its autosave comes.
    b.type(inB, 'FROM-B ')
    await b.save(inB)

    expect(disk.get(PATH)).toContain('FROM-A')
    expect(disk.get(PATH)).toContain('FROM-B')
    expect(inB.latest).toBe(disk.get(PATH))

    await wires.deliver()
    expect(inA.latest).toBe(disk.get(PATH))
    expect(inB.latest).toBe(disk.get(PATH))
  })

  test('words typed here are merged with what arrives, and owed to the file', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    inB.live.edit([{ from: 0, to: 0, insert: 'TOP ' }])
    inB.dirty = true
    a.type(inA, 'FROM-A ')
    await a.save(inA)
    await wires.deliver()

    expect(inB.latest).toBe(`TOP ${BASE}FROM-A `)
    expect(inB.dirty).toBe(true)
    expect(b.owed).toEqual([inB])
    await b.save(inB)
    await wires.deliver()
    expect(disk.get(PATH)).toBe(`TOP ${BASE}FROM-A `)
    expect(inA.latest).toBe(disk.get(PATH))
  })

  test('a key pressed while a merge is on its way stays', async () => {
    const { disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    a.type(inA, 'FROM-A ')
    await a.save(inA)
    b.type(inB, 'FROM-B ')
    const saving = b.save(inB)
    // Pressed after the save read the note, before the merge came back.
    inB.live.edit([{ from: 0, to: 0, insert: 'KEY ' }])
    await saving

    expect(disk.get(PATH)).toContain('FROM-A')
    expect(inB.latest).toContain('KEY')
    expect(inB.latest).toContain('FROM-A')
    expect(inB.latest).toContain('FROM-B')
  })

  test('both at one place in one moment come to the same words in both', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    a.type(inA, 'AAA')
    b.type(inB, 'BBB')
    await Promise.all([a.save(inA), b.save(inB)])
    await wires.deliver()
    for (let round = 0; round < 3; round += 1) {
      if (inA.dirty) await a.save(inA)
      if (inB.dirty) await b.save(inB)
      await wires.deliver()
    }

    expect(disk.get(PATH)).toContain('AAA')
    expect(disk.get(PATH)).toContain('BBB')
    expect(inA.latest).toBe(disk.get(PATH))
    expect(inB.latest).toBe(disk.get(PATH))
  })

  test('a note deleted in one does not come back when the other types, and keeps its words', async () => {
    const { wires, disk, a, b } = twoWindows()
    a.open(BASE)
    const inB = b.open(BASE)
    b.type(inB, 'AFTER-DELETE')
    disk.delete(PATH)
    a.windows.say('file-op', {
      op: { op: 'removed', path: PATH, kind: 'file', root: '/Notes' } satisfies FileOp,
    })
    await wires.deliver()

    expect(b.heard.at(-1)).toMatchObject({ op: 'removed', heard: true })
    expect(inB.path).toBeNull()
    expect(inB.latest).toContain('AFTER-DELETE')
    expect(await b.save(inB)).toBeNull()
    expect(disk.has(PATH)).toBe(false)
  })

  test('a file gone from under a write it has not heard of is not written back', async () => {
    const { disk, b } = twoWindows()
    const inB = b.open(BASE)
    b.type(inB, 'typed')
    disk.delete(PATH)

    expect(await b.save(inB)).toBeNull()
    expect(disk.has(PATH)).toBe(false)
    expect(inB.path).toBeNull()
    expect(inB.latest).toContain('typed')
  })

  test('a plane does not merge as text: the words a write replaces are kept as a version', async () => {
    const before = '{"nodes":[]}'
    const { wires, disk, a, b } = twoWindows(before)
    const inA = a.open(before, 'canvas')
    const inB = b.open(before, 'canvas')
    inA.replace('{"nodes":[1]}')
    await a.save(inA)
    inB.replace('{"nodes":[2]}')
    await b.save(inB)

    expect(disk.get(PATH)).toBe('{"nodes":[2]}')
    expect(b.versions).toEqual(['{"nodes":[1]}'])
    await wires.deliver()
    expect(inA.latest).toBe('{"nodes":[2]}')
    expect(inA.dirty).toBe(false)
  })
})
