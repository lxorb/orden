import { describe, expect, test } from 'vitest'
import { type InternalBytes, InternalFolder, type InternalWorld } from './folder'
import { MemoryBytes, sharedWindows } from './memory'

/** A space Orden keeps itself (#1068, step 4c): every file's bytes under a key that never
 *  changes, one index saying where each is, and every change said by what made it. */

function world(over: Partial<InternalWorld> = {}): InternalWorld {
  let keys = 0
  let clock = 1000
  return {
    now: () => (clock += 1),
    key: () => `k${String((keys += 1))}`,
    foldsCase: true,
    ...over,
  }
}

async function opened(bytes: InternalBytes = new MemoryBytes(), over: Partial<InternalWorld> = {}) {
  return InternalFolder.open('/spaces/.orden/one', bytes, world(over))
}

describe('a folder Orden keeps', () => {
  test('keeps a file under a key, with the folders above it', async () => {
    const bytes = new MemoryBytes()
    const folder = await opened(bytes)
    await folder.write('Work/Plan.md', 'ship it')

    const plan = await folder.at('Work/Plan.md')
    expect(plan?.key).toBe('k1.md')
    expect((await folder.at('Work'))?.key).toBeNull()
    expect(bytes.texts.get('k1.md')).toBe('ship it')
    expect(await folder.readText('work/plan.md')).toBe('ship it')
  })

  test('moves a folder by its index alone: every key stays and no byte is written', async () => {
    const bytes = new MemoryBytes()
    const folder = await opened(bytes)
    await folder.write('Work/Plan.md', 'ship it')
    await folder.write('Work/Deep/Eggs.md', 'eggs')
    const written = bytes.writes

    await folder.move('Work', 'Done/Work')

    expect(bytes.writes).toBe(written)
    expect((await folder.at('Done/Work/Plan.md'))?.key).toBe('k1.md')
    expect((await folder.at('Done/Work/Deep/Eggs.md'))?.key).toBe('k2.md')
    expect(await folder.at('Work/Plan.md')).toBeNull()
    expect(await folder.readText('Done/Work/Deep/Eggs.md')).toBe('eggs')
  })

  test('refuses a move onto something, into itself, or of nothing', async () => {
    const folder = await opened()
    await folder.write('A/x.md', 'x')
    await folder.write('B.md', 'b')

    await expect(folder.move('A', 'A/In')).rejects.toThrow('into itself')
    await expect(folder.move('B.md', 'A/x.md')).rejects.toThrow('already')
    await expect(folder.move('Nope.md', 'Yes.md')).rejects.toThrow('nothing')
    // Only its case changed, on a disk that compares names without it: the same file.
    await folder.move('B.md', 'b.md')
    expect((await folder.list()).map((one) => one.path)).toEqual(['A', 'A/x.md', 'b.md'])
  })

  test('reads its index back as it was written, and the newer slot where one was cut short', async () => {
    const bytes = new MemoryBytes()
    const first = await opened(bytes)
    await first.write('Plan.md', 'ship it')
    await first.mkdir('Empty')
    await first.move('Plan.md', 'Ship.md')

    const again = await opened(bytes)
    expect((await again.list()).map((one) => [one.path, one.entry.key])).toEqual([
      ['Empty', null],
      ['Ship.md', 'k1.md'],
    ])

    // The next write is lost halfway: the slot it was going to is gone, the other stands.
    bytes.failSlots = true
    await expect(again.move('Ship.md', 'Lost.md')).rejects.toThrow()
    bytes.failSlots = false
    const after = await opened(bytes)
    expect((await after.at('Ship.md'))?.key).toBe('k1.md')
  })

  test('deletes a path with everything under it, and the bytes after the index', async () => {
    const bytes = new MemoryBytes()
    const folder = await opened(bytes)
    await folder.write('Work/Plan.md', 'ship it')
    await folder.write('Work/x.png', new Uint8Array([1, 2]))

    await folder.remove('Work')

    expect(await folder.list()).toEqual([])
    expect([...bytes.texts.keys(), ...bytes.blobs.keys()]).toEqual([])
  })

  test('takes a thing into its trash with what goes with it, and puts it back under its keys', async () => {
    const bytes = new MemoryBytes()
    const folder = await opened(bytes)
    await folder.write('Paper.pdf', new Uint8Array([9]))
    await folder.write('Paper.pdf.highlights.json', '[]')

    const item = { id: 'internal-1', kind: 'note', name: 'Paper.pdf', trashedAt: 5 }
    expect(await folder.toTrash('Paper.pdf', item, ['Paper.pdf.highlights.json'])).toBe(true)
    expect(await folder.list()).toEqual([])
    expect(bytes.blobs.has('k1.pdf')).toBe(true)

    await folder.fromTrash('internal-1', 'Back/Paper 2.pdf')
    expect((await folder.at('Back/Paper 2.pdf'))?.key).toBe('k1.pdf')
    expect((await folder.at('Back/Paper 2.pdf.highlights.json'))?.key).toBe('k2.json')
    expect(await folder.trash()).toEqual([])

    await folder.toTrash('Back', { ...item, id: 'internal-2', kind: 'folder', name: 'Back' })
    await folder.purge('internal-2')
    expect([...bytes.texts.keys(), ...bytes.blobs.keys()]).toEqual([])
  })

  test('says every change exactly, as a watcher that is never wrong would', async () => {
    const folder = await opened()
    const heard: unknown[] = []
    folder.heard((changes) => heard.push(...changes))

    await folder.write('Plan.md', 'one')
    await folder.write('Plan.md', 'two')
    await folder.move('Plan.md', 'Ship.md')
    await folder.remove('Ship.md')

    expect(heard).toEqual([
      { kind: 'created', path: 'Plan.md', dir: false, size: 3, mtime: 1001, id: 'k1.md' },
      { kind: 'modified', path: 'Plan.md', dir: false, size: 3, mtime: 1002, id: 'k1.md' },
      {
        kind: 'renamed',
        from: 'Plan.md',
        path: 'Ship.md',
        dir: false,
        size: 3,
        mtime: 1002,
        id: 'k1.md',
      },
      { kind: 'removed', path: 'Ship.md', dir: false, id: 'k1.md' },
    ])
  })

  test('two windows on one folder each see what the other did', async () => {
    const bytes = new MemoryBytes()
    const windows = sharedWindows()
    const one = await opened(bytes, windows.world())
    const two = await opened(bytes, windows.world())
    const heard: string[] = []
    two.heard((changes) => heard.push(...changes.map((change) => change.kind)))

    await one.write('Plan.md', 'ship it')
    await windows.settled()
    expect((await two.at('Plan.md'))?.key).toBe('k1.md')

    await two.move('Plan.md', 'Ship.md')
    await windows.settled()
    expect(await one.at('Plan.md')).toBeNull()
    expect((await one.at('Ship.md'))?.key).toBe('k1.md')
    // The first window's next change starts from the index the second wrote.
    await one.write('More.md', 'more')
    expect((await opened(bytes)).atNow('Ship.md')).not.toBeNull()
    expect(heard).toContain('created')
  })

  test('writes when a file was last written down a moment after, or with the next change', async () => {
    const bytes = new MemoryBytes()
    const folder = await opened(bytes)
    await folder.write('Plan.md', 'one')
    await folder.write('Plan.md', 'three')
    expect((await opened(bytes)).atNow('Plan.md')?.size).toBe(3)

    await folder.flush()
    expect((await opened(bytes)).atNow('Plan.md')?.size).toBe(5)
  })
})
