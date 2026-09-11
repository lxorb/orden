import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileRow } from './store'

/** The space the search worker holds, driven against a store that lives in a Map.
 *
 *  What is asserted is rows read, not milliseconds: the point of the cache is that
 *  a second search over an unchanged space reads nothing at all, and a count says
 *  that where a clock only says what the machine was doing at the time. See the
 *  note beside the counters in search/fuzzy.ts. */

const disk = vi.hoisted(() => ({ files: new Map<string, FileRow>() }))

const inOrder = () => [...disk.files.keys()].sort()

vi.mock('./store', () => ({
  files: {
    get: (path: string) => Promise.resolve(disk.files.get(path)),
    paths: () => Promise.resolve(inOrder()),
    each: (visit: (row: FileRow) => void) => {
      for (const path of inOrder()) {
        const row = disk.files.get(path)
        if (row) visit(row)
      }
      return Promise.resolve()
    },
    between: (from: string, to: string) =>
      Promise.resolve(
        inOrder()
          .filter((path) => path >= from && path <= to)
          .flatMap((path) => {
            const row = disk.files.get(path)
            return row ? [row] : []
          }),
      ),
  },
}))

const { holdAtMost, space } = await import('./space-cache')
const { searchRows } = await import('./search')
const { parseQuery } = await import('../search/query')

const ROOT = '/Space'

function write(name: string, content: string, root = ROOT) {
  const path = `${root}/${name}`
  disk.files.set(path, { path, content, modified: 1, created: 1 })
  return path
}

/** One search: which notes answered, in the order they did, and how many rows it
 *  read out of the store while doing it. The names are the notes rather than the rows, since a
 *  note answers once per line that matched and what is being asked here is which
 *  notes the walk reached. */
async function searched(text: string, root = ROOT): Promise<{ names: string[]; reads: number }> {
  const names: string[] = []
  const before = space.warmth().read
  await searchRows(root, parseQuery(text), [], 50, (found) => {
    for (const hit of found.hits) {
      if (names.at(-1) !== hit.name) names.push(hit.name)
    }
  })

  return { names, reads: space.warmth().read - before }
}

beforeEach(() => {
  disk.files.clear()
  space.forget(null)
  holdAtMost(24_000_000)

  write('Plan.md', '# Plan\n\nThe quarter plan, and the wind above the field.')
  write('Ink.md', '# Ink\n\nA study of ink on paper.')
  write('Kestrel.md', '# Kestrel\n\nA kestrel hangs on the wind.')
})

describe('the space a search holds', () => {
  test('the first search reads the store and the next reads nothing', async () => {
    const cold = await searched('wind')
    expect(cold.names).toEqual(['Kestrel.md', 'Plan.md'])
    expect(cold.reads).toBe(3)

    const warm = await searched('wind')
    expect(warm.names).toEqual(cold.names)
    expect(warm.reads).toBe(0)
  })

  test('a query that found nothing still leaves the space warm', async () => {
    expect((await searched('zzzq')).reads).toBe(3)
    expect((await searched('zzzq')).reads).toBe(0)
    expect(space.warmth()).toMatchObject({ notes: 3, of: 3, warm: true })
  })

  test('the warm pass reads the space once and a search after it reads nothing', async () => {
    await space.fill(ROOT)
    expect(space.warmth()).toMatchObject({ notes: 3, of: 3, read: 3, warm: true })

    const found = await searched('ink')
    expect(found.names).toEqual(['Ink.md'])
    expect(found.reads).toBe(0)

    // And a second pass over a space already held reads nothing either.
    await space.fill(ROOT)
    expect(space.warmth().read).toBe(3)
  })

  test('a walk that stopped early leaves the space to the warm pass', async () => {
    const found: string[] = []
    await searchRows(ROOT, parseQuery('the'), [], 1, (batch) => {
      for (const hit of batch.hits) found.push(hit.name)
    })

    expect(found.length).toBe(1)
    expect(space.warmth().warm).toBe(false)

    await space.fill(ROOT)
    expect(space.warmth()).toMatchObject({ of: 3, warm: true })
    expect((await searched('wind')).reads).toBe(0)
  })
})

describe('keeping up with the store', () => {
  test('a note that was written answers from what was written', async () => {
    await space.fill(ROOT)

    const path = write('Plan.md', '# Plan\n\nThe quarter plan, and a kestrel in it.')
    space.wrote({
      path,
      content: '# Plan\n\nThe quarter plan, and a kestrel in it.',
      modified: 2,
      created: 1,
    })

    const found = await searched('kestrel')
    expect(found.names).toEqual(['Kestrel.md', 'Plan.md'])
    expect(found.reads).toBe(0)
  })

  test('a note that has gone stops answering, and a new one starts', async () => {
    await space.fill(ROOT)

    disk.files.delete(`${ROOT}/Kestrel.md`)
    space.gone(`${ROOT}/Kestrel.md`)

    let found = await searched('kestrel')
    expect(found.names).toEqual([])
    expect(found.reads).toBe(0)

    const path = write('Bird.md', '# Bird\n\nA kestrel again.')
    space.wrote({ path, content: '# Bird\n\nA kestrel again.', modified: 3, created: 3 })

    found = await searched('kestrel')
    expect(found.names).toEqual(['Bird.md'])
    expect(found.reads).toBe(0)
    // In path order, which is the order a space answers in: the new note sits
    // where its name puts it rather than at the end.
    expect((await searched('a')).names[0]).toBe('Bird.md')
  })

  test('a note written into a space nobody has read yet is not held twice', async () => {
    const path = write('Bird.md', '# Bird\n\nA kestrel again.')
    space.wrote({ path, content: '# Bird\n\nA kestrel again.', modified: 3, created: 3 })

    await space.fill(ROOT)
    expect(space.warmth()).toMatchObject({ notes: 4, of: 4 })
    expect((await searched('kestrel')).names).toEqual(['Bird.md', 'Kestrel.md'])
  })

  test('another space is another question, and the one before it is let go', async () => {
    await space.fill(ROOT)
    write('Other.md', '# Other\n\nAnother wind entirely.', '/Elsewhere')

    const found = await searched('wind', '/Elsewhere')
    expect(found.names).toEqual(['Other.md'])
    expect(space.warmth()).toMatchObject({ notes: 1, of: 1 })

    // And the space that was held is read again when it is asked about again. The
    // count starts again with the space, so it is what was read that says so.
    expect((await searched('wind')).names).toEqual(['Kestrel.md', 'Plan.md'])
    expect(space.warmth()).toMatchObject({ notes: 3, of: 3, read: 4 })
  })
})

describe('the cap', () => {
  test('the largest notes go first, and are read again when a search reaches them', async () => {
    write('Novel.md', `# Novel\n\n${'ink '.repeat(400)}`)
    await space.fill(ROOT)
    const full = space.warmth()
    expect(full.notes).toBe(4)

    // Small enough that the novel cannot stay and the three short notes can.
    holdAtMost(600)
    await searched('nothing at all')
    const held = space.warmth()

    expect(held.notes).toBe(3)
    expect(held.of).toBe(4)
    expect(held.dropped).toBe(1)
    expect(held.characters).toBeLessThanOrEqual(600)

    // The note that was let go is one row read, not a space.
    const found = await searched('Novel')
    expect(found.names).toEqual(['Novel.md'])
    expect(found.reads).toBe(1)
  })

  test('and the notes after one the store has lost still answer', async () => {
    // A long note the cap will not keep, sitting in the middle of the space: Ink
    // comes after Deep and before Kestrel in path order.
    write('Deep.md', '# Deep\n\nThe first of them.')
    write('Ink.md', `# Ink\n\n${'ink '.repeat(400)}`)
    await space.fill(ROOT)

    holdAtMost(600)
    await searched('nothing at all')
    expect(space.warmth().dropped).toBe(1)

    // And then it goes from the store as well, behind the cache's back, which is
    // what a second tab of the same app writing these rows looks like from here. A
    // walk that took the missing path out of the order as it went and then carried
    // on from where it was would step over whatever followed it.
    disk.files.delete(`${ROOT}/Ink.md`)

    const found = await searched('the')
    expect(found.names).toEqual(['Deep.md', 'Kestrel.md', 'Plan.md'])
    // And the note that has gone is out of the space: four notes, three of them.
    expect(space.warmth().of).toBe(3)
  })

  test('a note the cap let go of and the store no longer holds is forgotten', async () => {
    write('Novel.md', `# Novel\n\n${'ink '.repeat(400)}`)
    await space.fill(ROOT)
    holdAtMost(600)
    await searched('nothing at all')

    disk.files.delete(`${ROOT}/Novel.md`)
    expect((await searched('Novel')).names).toEqual([])
    expect(space.warmth().of).toBe(3)
  })
})
