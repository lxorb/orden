import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileRow } from './store'

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
const { parseQuery } = await import('@orden/scan/search/query')

const ROOT = '/Space'

function write(name: string, content: string, root = ROOT) {
  const path = `${root}/${name}`
  disk.files.set(path, { path, content, modified: 1, created: 1 })
  return path
}

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
  test("leaves the app's own notes out, warm or cold, as the crate's walk does", async () => {
    write('.Inbox.md', '- [ ] wind the clock')
    write('.orden/Draft.md', 'wind')

    expect((await searched('wind')).names).toEqual(['Kestrel.md', 'Plan.md'])
    await space.fill(ROOT)
    expect((await searched('wind')).names).toEqual(['Kestrel.md', 'Plan.md'])
    await space.rewritten(`${ROOT}/.Inbox.md`)
    expect((await searched('wind')).names).toEqual(['Kestrel.md', 'Plan.md'])
  })

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

    holdAtMost(600)
    await searched('nothing at all')
    const held = space.warmth()

    expect(held.notes).toBe(3)
    expect(held.of).toBe(4)
    expect(held.dropped).toBe(1)
    expect(held.characters).toBeLessThanOrEqual(600)

    const found = await searched('Novel')
    expect(found.names).toEqual(['Novel.md'])
    expect(found.reads).toBe(1)
  })

  test('and the notes after one the store has lost still answer', async () => {
    write('Deep.md', '# Deep\n\nThe first of them.')
    write('Ink.md', `# Ink\n\n${'ink '.repeat(400)}`)
    await space.fill(ROOT)

    holdAtMost(600)
    await searched('nothing at all')
    expect(space.warmth().dropped).toBe(1)

    disk.files.delete(`${ROOT}/Ink.md`)

    const found = await searched('the')
    expect(found.names).toEqual(['Deep.md', 'Kestrel.md', 'Plan.md'])
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

  describe('a space the folds alone put over it', () => {
    function tight() {
      const bodies = [...disk.files.values()].reduce((sum, row) => sum + row.content.length, 0)
      holdAtMost(Math.round(bodies * 1.5))
      return bodies
    }

    test('lets the folds go and keeps every note', async () => {
      await space.fill(ROOT)
      const bodies = tight()

      await searched('wind')
      const held = space.warmth()

      expect(held.notes).toBe(3)
      expect(held.dropped).toBe(0)
      expect(held.characters).toBeLessThanOrEqual(held.cap)
      expect(held.characters).toBeGreaterThanOrEqual(bodies)
    })

    test('so a second search still reads nothing at all', async () => {
      await space.fill(ROOT)
      tight()

      expect((await searched('wind')).reads).toBe(0)
      expect((await searched('wind')).reads).toBe(0)
      expect((await searched('zzzq')).reads).toBe(0)
      expect(space.warmth()).toMatchObject({ notes: 3, of: 3, dropped: 0 })
    })

    test('and answers the same as a space with room to spare', async () => {
      await space.fill(ROOT)
      const roomy = await searched('wind')

      space.forget(null)
      await space.fill(ROOT)
      tight()
      const tightly = await searched('wind')

      expect(tightly.names).toEqual(roomy.names)
    })
  })
})
