/** One note open in two windows, with real documents and one disk: H2-DESKTOP-14. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { oneWriteAt, Windows } from '../windows'
import { NoteDoc } from './documents.svelte'
import { Across, type Desk } from './across'
import type { FileOp } from './file-ops'

vi.mock('../log', () => ({ log: vi.fn() }))

/** A browser's locks, one holder per name in the order asked. */
function fakeLocks(): LockManager {
  const tails = new Map<string, Promise<unknown>>()
  return {
    request(name: string, ...rest: unknown[]) {
      const run = rest.at(-1) as (lock: unknown) => unknown
      const options = (rest.length > 1 ? rest[0] : {}) as { ifAvailable?: boolean }
      if (options.ifAvailable) return Promise.resolve(run({ name }))
      const done = (tails.get(name) ?? Promise.resolve()).then(() => run({ name }))
      tails.set(
        name,
        done.catch(() => undefined),
      )
      return done
    },
  } as unknown as LockManager
}

beforeEach(() => vi.stubGlobal('navigator', { locks: fakeLocks() }))
afterEach(() => vi.unstubAllGlobals())

/** Windows' ends of one channel. Delivery is held until asked for, in whatever order: which
 *  is a window that has not heard yet. */
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
    flight,
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
  let failing = false
  let reachable = true
  let moved: (() => void) | null = null
  const documents: NoteDoc[] = []
  const heard: FileOp[] = []
  const owed: NoteDoc[] = []
  const edited: NoteDoc[] = []
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
    read: async (path) => {
      await Promise.resolve()
      return failing ? null : (disk.get(path) ?? null)
    },
    exists: async (path) => disk.has(path) || failing,
    reachable: async () => reachable,
    pause: async () => {
      moved?.()
    },
    keepVersion: async (_path, text) => void versions.push(text),
  }
  const windows = new Windows(() => line)
  const across = new Across(desk, windows)
  const open = (text: string, kind: NoteDoc['kind'] = 'note') => {
    const note = new NoteDoc({ kind, path: PATH, name: 'Both.md', text, dirty: false }, (one) =>
      edited.push(one),
    )
    documents.push(note)
    return note
  }
  /** What autosave does. */
  const save = async (note: NoteDoc) => {
    const path = note.path
    if (path === null) return null
    const written = await across.writing(note, path, async (down) => {
      disk.set(path, down)
    })
    if (written !== null) note.dirty = note.latest !== written.words
    return written
  }
  const type = (note: NoteDoc, words: string) => {
    note.live.edit([{ from: note.live.text.length, to: note.live.text.length, insert: words }])
    note.dirty = true
  }
  const failRead = (on: boolean) => {
    failing = on
  }
  const outOfReach = (on: boolean) => {
    reachable = !on
  }
  const renamedSoon = (note: NoteDoc, to: string) => {
    moved = () => {
      note.path = to
    }
  }
  return {
    across,
    windows,
    open,
    save,
    type,
    heard,
    owed,
    edited,
    versions,
    documents,
    failRead,
    outOfReach,
    renamedSoon,
  }
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

/** A token typed into a note, one of a kind, so a count of it says lost or twice. */
function random(seed: number) {
  let state = seed * 2654435761 + 1
  return (below: number) => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state % below
  }
}

const count = (text: string, token: string) => text.split(token).length - 1

describe('whatever order the news arrives in', () => {
  test('a write that met the disk and then hears of it does not bring it in twice', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    a.type(inA, 'ONE ')
    await a.save(inA)
    a.type(inA, 'TWO ')
    await a.save(inA)
    b.type(inB, 'BEE ')
    await b.save(inB)
    await wires.deliver()

    for (const token of ['ONE ', 'TWO ', 'BEE ']) {
      expect(count(disk.get(PATH) ?? '', token)).toBe(1)
      expect(count(inA.latest, token)).toBe(1)
      expect(count(inB.latest, token)).toBe(1)
    }
  })

  test.each(Array.from({ length: 80 }, (_, seed) => seed))(
    'three windows, seed %i: no word lost and none twice',
    async (seed) => {
      const pick = random(seed + 1)
      const wires = channel()
      const start = 'one\ntwo\nthree\nfour\nfive\n'
      const disk = new Map([[PATH, start]])
      const windows = [0, 1, 2].map(() => aWindow(wires.end(), disk))
      const notes = windows.map((one) => one.open(start))
      const tokens: string[] = []
      const running: Promise<unknown>[] = []
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

      for (let step = 0; step < 30; step += 1) {
        const at = pick(3)
        const window = windows[at]
        const note = notes[at]
        if (!window || !note) continue
        const move = pick(4)
        if (move === 0) {
          const token = `tk${String(tokens.length)}z`
          tokens.push(token)
          const lines = note.live.text.toString().split('\n')
          const line = pick(lines.length)
          const from = lines.slice(0, line).join('\n').length + (line ? 1 : 0)
          note.live.edit([{ from, to: from, insert: `${token} ` }])
          note.dirty = true
        } else if (move === 1) {
          running.push(window.save(note))
        } else if (wires.flight.length) {
          const [one] = wires.flight.splice(pick(wires.flight.length), 1)
          one?.()
        }
        if (pick(2)) await tick()
      }
      await Promise.all(running)

      // Everybody hears everything, in any order, and writes what they owe.
      for (let round = 0; round < 12; round += 1) {
        while (wires.flight.length) {
          const [one] = wires.flight.splice(pick(wires.flight.length), 1)
          one?.()
          await tick()
        }
        await Promise.all(windows.map((one) => one.across.heardSoFar()))
        await tick()
        await Promise.all(
          windows.map(async (one, at) => (notes[at]?.dirty ? await one.save(notes[at]) : null)),
        )
        await tick()
        await Promise.all(windows.map((one) => one.across.heardSoFar()))
      }

      const final = disk.get(PATH) ?? ''
      for (const token of tokens) expect([token, count(final, token)]).toEqual([token, 1])
      for (const note of notes) expect(note.latest).toBe(final)
    },
  )
})

describe('around one write', () => {
  test('words that arrive while the disk is being read go down with it', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    a.type(inA, 'FROM-A ')
    await a.save(inA)
    // B's save asked before it hears, A's news handled while B waits on its read.
    b.type(inB, 'FROM-B ')
    const saving = b.save(inB)
    await wires.deliver()
    await saving
    await wires.deliver()
    for (let round = 0; round < 3; round += 1) {
      if (inB.dirty) await b.save(inB)
      if (inA.dirty) await a.save(inA)
      await wires.deliver()
    }

    expect(disk.get(PATH)).toContain('FROM-A')
    expect(disk.get(PATH)).toContain('FROM-B')
    expect(inA.latest).toBe(disk.get(PATH))
    expect(inB.latest).toBe(disk.get(PATH))
  })

  test('a file that will not read is not an empty file: nothing doubles, and the write is refused', async () => {
    const { disk, b } = twoWindows()
    const inB = b.open(BASE)
    b.type(inB, 'typed')
    b.failRead(true)

    await expect(b.save(inB)).rejects.toThrow()
    expect(disk.get(PATH)).toBe(BASE)
    expect(count(inB.latest, 'base line')).toBe(1)
    b.failRead(false)
    expect(await b.save(inB)).toBeTruthy()
    expect(disk.get(PATH)).toBe(`${BASE}typed`)
  })

  test('a write racing a rename follows the note, and it does not go draft', async () => {
    const { disk, b } = twoWindows()
    const inB = b.open(BASE)
    b.type(inB, 'typed')
    disk.delete(PATH)
    disk.set('/Notes/Moved.md', BASE)
    // The rename's news comes while the write is out.
    b.renamedSoon(inB, '/Notes/Moved.md')

    expect(await b.save(inB)).toBeNull()
    expect(inB.path).toBe('/Notes/Moved.md')
    expect(b.owed).toEqual([inB])
    expect(disk.has(PATH)).toBe(false)
  })
})

/** The crate's write: the file keeps the line endings it has, whatever the editor holds. */
function savingLikeTheCrate(window: ReturnType<typeof aWindow>, disk: Map<string, string>) {
  return async (note: NoteDoc) => {
    const path = note.path
    if (path === null) return null
    const written = await window.across.writing(note, path, async (down) => {
      const crlf = (disk.get(path) ?? '').includes('\r\n')
      disk.set(path, crlf ? down.replace(/\n/g, '\r\n') : down)
    })
    if (written !== null) note.dirty = note.latest !== written.words
    return written
  }
}

const CRLF = '# Title\r\n\r\nFirst paragraph here.\r\n\r\nSecond paragraph here.\r\n\r\nThird one.\r\n'
const LF = CRLF.replace(/\r\n/g, '\n')

describe('a file with CRLF endings', () => {
  test('holds one line ending, whatever way the words came in', () => {
    const doc = new NoteDoc(
      { kind: 'note', path: PATH, name: 'Both.md', text: CRLF, dirty: false },
      () => undefined,
    )
    expect(doc.latest).toBe(LF)
    expect(doc.text).toBe(LF)
    expect(doc.onDisk).toBe(LF)

    doc.replace('a\r\nb\rc\n', false)
    expect(doc.latest).toBe('a\nb\nc\n')
    expect(doc.onDisk).toBe('a\nb\nc\n')

    doc.adopt({ path: '/Notes/Other.md', name: 'Other.md', text: 'x\r\ny\r\n' })
    expect(doc.latest).toBe('x\ny\n')
    expect(doc.onDisk).toBe('x\ny\n')

    doc.replace('p\r\nq', true)
    doc.flush()
    expect(doc.text).toBe('p\nq')
    doc.wroteAs('p\r\nq')
    expect(doc.dirty).toBe(false)
    expect(doc.onDisk).toBe('p\nq')
  })

  test('the first write still keeps the file as it was', () => {
    const doc = new NoteDoc(
      { kind: 'note', path: PATH, name: 'Both.md', text: CRLF, dirty: false },
      () => undefined,
    )
    expect(doc.firstVersion()).toBe(CRLF)
  })

  test('a clean window hears the other, and what it types afterwards is still owed', async () => {
    const { wires, disk, a, b } = twoWindows(CRLF)
    const inA = a.open(CRLF)
    const inB = b.open(CRLF)
    b.type(inB, 'FROM-B ')
    await savingLikeTheCrate(b, disk)(inB)
    await wires.deliver()

    expect(inA.latest).toBe(`${LF}FROM-B `)
    expect(inA.dirty).toBe(false)

    inA.live.edit([{ from: 0, to: 0, insert: 'FROM-A ' }])
    expect(inA.dirty).toBe(true)
    expect(a.edited).toEqual([inA])
    await savingLikeTheCrate(a, disk)(inA)
    await wires.deliver()

    const words = `FROM-A ${LF}FROM-B `
    expect(inA.latest).toBe(words)
    expect(inB.latest).toBe(words)
    // Every line the file had keeps its ending; only what was typed since has none to keep.
    expect(disk.get(PATH)).toBe(words.replace(/\n/g, '\r\n'))
  })

  test('words typed before the news arrives merge with it, in both orders', async () => {
    const { wires, disk, a, b } = twoWindows(CRLF)
    const inA = a.open(CRLF)
    const inB = b.open(CRLF)
    inA.live.edit([{ from: 2, to: 2, insert: 'AAA ' }])
    b.type(inB, 'BBB ')
    await savingLikeTheCrate(b, disk)(inB)
    await wires.deliver()
    expect(inA.latest).toContain('AAA')
    expect(inA.latest).toContain('BBB')
    expect(inA.latest).not.toContain('\r')

    await savingLikeTheCrate(a, disk)(inA)
    await wires.deliver()
    expect(disk.get(PATH)).toContain('AAA')
    expect(disk.get(PATH)).toContain('BBB')
    expect(inB.latest).toBe(inA.latest)
    expect(count(inB.latest, 'Third one.')).toBe(1)
  })

  test.each([
    ['at the end', (end: number) => ({ from: end, to: end, insert: 'TYPED' })],
    ['in a word', () => ({ from: 15, to: 15, insert: 'TYPED' })],
    ['a paragraph', () => ({ from: 31, to: 31, insert: '\n\nA whole new paragraph\n' })],
    ['a word out', () => ({ from: 9, to: 15, insert: '' })],
    ['a word changed', () => ({ from: 9, to: 14, insert: 'Changed' })],
  ])('a write of an edit %s, with another window here', async (_name, edit) => {
    const { disk, a } = twoWindows(CRLF)
    const inA = a.open(CRLF)
    inA.live.edit([edit(inA.live.text.length)])
    const wanted = inA.live.text.toString()
    await savingLikeTheCrate(a, disk)(inA)

    expect(disk.get(PATH)?.replace(/\r\n/g, '\n')).toBe(wanted)
    expect(inA.latest).toBe(wanted)
    expect(inA.dirty).toBe(false)
    expect(a.versions).toEqual([])
  })

  test('a file another program turned to CRLF is no news, and no merge', async () => {
    const { wires, disk, a, b } = twoWindows(LF)
    const inA = a.open(LF)
    b.open(LF)
    disk.set(PATH, CRLF)
    a.type(inA, 'TYPED')
    await savingLikeTheCrate(a, disk)(inA)
    await wires.deliver()
    expect(disk.get(PATH)).toBe(`${LF}TYPED`.replace(/\n/g, '\r\n'))
    expect(count(inA.latest, 'First paragraph')).toBe(1)
  })

  test.each(Array.from({ length: 20 }, (_, seed) => seed))(
    'three windows on it, seed %i: no word lost and none twice',
    async (seed) => {
      const pick = random(seed + 101)
      const wires = channel()
      const disk = new Map([[PATH, 'one\r\ntwo\r\nthree\r\nfour\r\n']])
      const windows = [0, 1, 2].map(() => aWindow(wires.end(), disk))
      const notes = windows.map((one) => one.open('one\r\ntwo\r\nthree\r\nfour\r\n'))
      const saves = windows.map((one) => savingLikeTheCrate(one, disk))
      const tokens: string[] = []
      const running: Promise<unknown>[] = []
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

      for (let step = 0; step < 24; step += 1) {
        const at = pick(3)
        const note = notes[at]
        if (!note) continue
        const move = pick(4)
        if (move === 0) {
          // No two start or end alike: two inserts at one place meet by the letter, and a
          // shared letter would read as a token cut in two.
          const token = `${String.fromCharCode(65 + tokens.length)}-${String(tokens.length)}-${String.fromCharCode(97 + tokens.length)}`
          tokens.push(token)
          const lines = note.live.text.toString().split('\n')
          const line = pick(lines.length)
          const from = lines.slice(0, line).join('\n').length + (line ? 1 : 0)
          note.live.edit([{ from, to: from, insert: token }])
        } else if (move === 1) {
          running.push(saves[at]?.(note))
        } else if (wires.flight.length) {
          const [one] = wires.flight.splice(pick(wires.flight.length), 1)
          one?.()
        }
        if (pick(2)) await tick()
      }
      await Promise.all(running)

      for (let round = 0; round < 12; round += 1) {
        while (wires.flight.length) {
          const [one] = wires.flight.splice(pick(wires.flight.length), 1)
          one?.()
          await tick()
        }
        await Promise.all(windows.map((one) => one.across.heardSoFar()))
        await tick()
        await Promise.all(
          notes.map(async (note, at) => (note.dirty ? await saves[at]?.(note) : null)),
        )
        await tick()
        await Promise.all(windows.map((one) => one.across.heardSoFar()))
      }

      const final = (disk.get(PATH) ?? '').replace(/\r\n/g, '\n')
      for (const token of tokens) expect([token, count(final, token)]).toEqual([token, 1])
      for (const note of notes) expect(note.latest).toBe(final)
    },
  )
})

describe('a merge that throws does not stop the saving', () => {
  const refusing = (note: NoteDoc) => {
    const arrived = vi.spyOn(note.live, 'arrived').mockImplementation(() => {
      throw new RangeError('Invalid change range')
    })
    return () => arrived.mockRestore()
  }

  test.each([
    ['replace', (note: NoteDoc) => vi.spyOn(note.live, 'replace')],
    ['edit', (note: NoteDoc) => vi.spyOn(note.live, 'edit')],
    ['takeOn', (note: NoteDoc) => vi.spyOn(note.live, 'takeOn')],
  ] as const)('a throw out of the rope in %s leaves typing owed', (name, spy) => {
    const edited: NoteDoc[] = []
    const note = new NoteDoc(
      { kind: 'note', path: PATH, name: 'Both.md', text: BASE, dirty: false },
      (one) => edited.push(one),
    )
    const stub = spy(note).mockImplementation(() => {
      throw new RangeError('no')
    })
    const act: Record<typeof name, () => void> = {
      replace: () => note.replace('x', false),
      edit: () => note.edited([{ from: 0, to: 0, insert: 'x' }], `x${BASE}`),
      takeOn: () => note.adopt({ path: PATH, name: 'Both.md', text: 'x' }),
    }
    expect(act[name]).toThrow()
    stub.mockRestore()

    note.live.edit([{ from: 0, to: 0, insert: 'typed' }])
    expect(note.dirty).toBe(true)
    expect(edited).toEqual([note])
  })

  test('took: the rope refuses, and typing afterwards is still owed', () => {
    const edited: NoteDoc[] = []
    const note = new NoteDoc(
      { kind: 'note', path: PATH, name: 'Both.md', text: BASE, dirty: false },
      (one) => edited.push(one),
    )
    const restore = refusing(note)
    expect(() => note.took({ from: 0, to: 0, insert: 'x' }, `x${BASE}`)).toThrow()
    restore()
    note.live.edit([{ from: 0, to: 0, insert: 'typed' }])
    expect(note.dirty).toBe(true)
    expect(edited).toEqual([note])
  })

  test('heard: the words still come in, and the note stays clean', async () => {
    const { wires, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    const restore = refusing(inA)
    b.type(inB, 'FROM-B ')
    await b.save(inB)
    await wires.deliver()
    restore()

    expect(inA.latest).toBe(`${BASE}FROM-B `)
    expect(inA.dirty).toBe(false)
    inA.live.edit([{ from: 0, to: 0, insert: 'typed' }])
    expect(inA.dirty).toBe(true)
  })

  test('heard with words of its own: both stay, and they are owed', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    inA.live.edit([{ from: 0, to: 0, insert: 'TOP ' }])
    const restore = refusing(inA)
    b.type(inB, 'FROM-B ')
    await b.save(inB)
    await wires.deliver()
    restore()

    expect(inA.latest).toBe(`TOP ${BASE}FROM-B `)
    expect(inA.dirty).toBe(true)
    expect(a.owed).toContain(inA)
    await a.save(inA)
    expect(disk.get(PATH)).toBe(`TOP ${BASE}FROM-B `)
  })

  test('at a write: the write goes down with both', async () => {
    const { disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    b.type(inB, 'FROM-B ')
    await b.save(inB)
    inA.live.edit([{ from: 0, to: 0, insert: 'TOP ' }])
    const restore = refusing(inA)
    expect(await a.save(inA)).toBeTruthy()
    restore()

    expect(disk.get(PATH)).toBe(`TOP ${BASE}FROM-B `)
    expect(inA.dirty).toBe(false)
  })

  test('where nothing will take them, the write says so rather than saying nothing', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    b.type(inB, 'FROM-B ')
    await b.save(inB)
    inA.live.edit([{ from: 0, to: 0, insert: 'TOP ' }])
    const restore = refusing(inA)
    const replacing = vi.spyOn(inA.live, 'replace').mockImplementation(() => {
      throw new RangeError('no')
    })

    await expect(a.save(inA)).rejects.toThrow()
    await wires.deliver()
    expect(a.owed).toContain(inA)
    expect(inA.dirty).toBe(true)
    expect(inA.latest).toContain('TOP')

    restore()
    replacing.mockRestore()
    expect(await a.save(inA)).toBeTruthy()
    expect(disk.get(PATH)).toBe(`TOP ${BASE}FROM-B `)
  })
})

describe('while an input method is composing', () => {
  /** A view of the note that is in the middle of a composition. */
  const composing = (note: NoteDoc) => {
    const view = {
      get state() {
        return note.live.state
      },
      dispatch: () => undefined,
      composing: true,
    }
    note.live.join(view as never)
    return view
  }

  test('two writes heard are taken in once it ends, with none lost and none twice', async () => {
    const { wires, disk, a, b } = twoWindows()
    const inA = a.open(BASE)
    const inB = b.open(BASE)
    const view = composing(inA)
    b.type(inB, 'ONE ')
    await b.save(inB)
    await wires.deliver()
    b.type(inB, 'TWO ')
    await b.save(inB)
    await wires.deliver()

    view.composing = false
    inA.live.settle()
    await wires.deliver()
    await a.save(inA)
    await wires.deliver()

    for (const token of ['ONE ', 'TWO ']) {
      expect(count(disk.get(PATH) ?? '', token)).toBe(1)
      expect(count(inA.latest, token)).toBe(1)
    }
    expect(inA.latest).toBe(disk.get(PATH))
  })
})

describe('a file operation in another window', () => {
  test('a delete waits for a write in the air, and the file stays gone', async () => {
    const { disk, a } = twoWindows()
    const inA = a.open(BASE)
    a.type(inA, 'WORDS ')
    const saving = a.save(inA)
    const deleting = oneWriteAt(PATH, async () => void disk.delete(PATH))
    await Promise.all([saving, deleting])
    expect(disk.has(PATH)).toBe(false)
  })

  test('a delete ahead of the write: the write finds it gone', async () => {
    const { disk, a } = twoWindows()
    const inA = a.open(BASE)
    a.type(inA, 'WORDS ')
    const deleting = oneWriteAt(PATH, async () => void disk.delete(PATH))
    const saving = a.save(inA)
    await Promise.all([saving, deleting])
    expect(disk.has(PATH)).toBe(false)
    expect(inA.path).toBeNull()
    expect(inA.latest).toContain('WORDS')
  })

  test('a rename heard during the read: the write follows the note', async () => {
    const { disk, a } = twoWindows()
    const inA = a.open(BASE)
    a.type(inA, 'WORDS ')
    const to = '/Notes/Moved.md'
    const saving = a.save(inA)
    // A microtask later: the read is on its way.
    await Promise.resolve()
    inA.path = to
    disk.set(to, disk.get(PATH) ?? '')
    await saving
    expect(disk.get(PATH)).toBe(BASE)
    expect(a.owed).toContain(inA)
  })
})

describe('a share gone offline', () => {
  test('is not a file gone: the note keeps its path, and the write says it was refused', async () => {
    const { disk, a } = twoWindows()
    const inA = a.open(BASE)
    a.type(inA, 'WORDS ')
    disk.delete(PATH)
    a.outOfReach(true)

    await expect(a.save(inA)).rejects.toThrow()
    expect(inA.path).toBe(PATH)
    expect(inA.dirty).toBe(true)

    a.outOfReach(false)
    disk.set(PATH, BASE)
    expect(await a.save(inA)).toBeTruthy()
    expect(disk.get(PATH)).toBe(`${BASE}WORDS `)
  })

  test('a file gone from a share that answers is still gone', async () => {
    const { disk, a } = twoWindows()
    const inA = a.open(BASE)
    a.type(inA, 'WORDS ')
    disk.delete(PATH)
    expect(await a.save(inA)).toBeNull()
    expect(inA.path).toBeNull()
  })
})
