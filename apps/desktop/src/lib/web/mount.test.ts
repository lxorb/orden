import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { assets, type AssetRow, type FileRow, files, mountRows, type Rows, stats } from './store'

/** Rows mounted at a folder (#1068, step 4c): what is at or under it is kept by the
 *  store mounted there and not by this browser's, through the same tables, so every
 *  command above them answers a space Orden keeps by id as it answers any other. */

interface Kept {
  rows: Rows
  files: Map<string, FileRow>
  assets: Map<string, AssetRow>
}

/** A store of rows in memory, as a mounted one answers. */
function kept(): Kept {
  const held = new Map<string, FileRow>()
  const pictures = new Map<string, AssetRow>()
  const sorted = <T>(map: Map<string, T>) => [...map.keys()].sort().map((key) => map.get(key) as T)
  const listing = () =>
    [...sorted(held), ...sorted(pictures)]
      .map((row) => ({
        path: row.path,
        modified: row.modified,
        created: 'created' in row ? row.created : row.modified,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
  const rows: Rows = {
    files: {
      get: (path) => Promise.resolve(held.get(path)),
      all: () => Promise.resolve(sorted(held)),
      paths: () => Promise.resolve([...held.keys()].sort()),
      each: (visit) => {
        for (const row of sorted(held)) visit(row)
        return Promise.resolve()
      },
      between: (from, to) =>
        Promise.resolve(sorted(held).filter((row) => row.path >= from && row.path <= to)),
      put: (row) => Promise.resolve(void held.set(row.path, row)),
      write: (path, content, at) => {
        const created = held.get(path)?.created ?? at
        return Promise.resolve(void held.set(path, { path, content, created, modified: at }))
      },
      remove: (path) => Promise.resolve(void held.delete(path)),
      move: (moved, gone) => {
        for (const path of gone) held.delete(path)
        for (const row of moved) held.set(row.path, row)
        return Promise.resolve()
      },
    },
    assets: {
      get: (path) => Promise.resolve(pictures.get(path)),
      all: () => Promise.resolve(sorted(pictures)),
      paths: () => Promise.resolve([...pictures.keys()].sort()),
      put: (row) => Promise.resolve(void pictures.set(row.path, row)),
      remove: (path) => Promise.resolve(void pictures.delete(path)),
    },
    stats: {
      holds: (path) =>
        Promise.resolve(
          listing().some((row) => row.path === path || row.path.startsWith(`${path}/`)),
        ),
      all: () => Promise.resolve(listing()),
      learn: () => Promise.resolve(),
    },
  }
  return { rows, files: held, assets: pictures }
}

describe('rows mounted at a folder', () => {
  test('keep what is at or under it, and nothing else', async () => {
    const mounted = kept()
    const away = mountRows('/Kept', mounted.rows)
    await files.write('/Kept/Plan.md', 'ship it', 1)
    await files.write('/Notes/Other.md', 'elsewhere', 1)
    await assets.put({ path: '/Kept/cat.png', type: 'image/png', data: 'data:', modified: 1 })

    expect(mounted.files.get('/Kept/Plan.md')?.content).toBe('ship it')
    expect(mounted.files.has('/Notes/Other.md')).toBe(false)
    expect(mounted.assets.has('/Kept/cat.png')).toBe(true)
    // A folder whose name only starts the same is not under it.
    await files.write('/Kept two/Not.md', 'not kept', 1)
    expect(mounted.files.has('/Kept two/Not.md')).toBe(false)

    // A whole-store read is every store's, in path order.
    expect(await files.paths()).toEqual(['/Kept two/Not.md', '/Kept/Plan.md', '/Notes/Other.md'])
    expect((await stats.all()).map((row) => row.path)).toContain('/Kept/cat.png')

    away()
    expect(await files.get('/Kept/Plan.md')).toBeUndefined()
    expect(await files.get('/Notes/Other.md')).toBeDefined()
    await files.remove('/Notes/Other.md')
    await files.remove('/Kept two/Not.md')
  })

  test('hold a folder above them, and a move between two stores lands in each', async () => {
    const mounted = kept()
    const away = mountRows('/Spaces/Kept', mounted.rows)
    await files.write('/Spaces/Kept/Plan.md', 'ship it', 1)
    expect(await stats.holds('/Spaces')).toBe(true)
    expect(await stats.holds('/Elsewhere')).toBe(false)

    const row = await files.get('/Spaces/Kept/Plan.md')
    if (!row) throw new Error('no row')
    await files.move([{ ...row, path: '/Notes/Plan.md' }], ['/Spaces/Kept/Plan.md'])
    expect(mounted.files.size).toBe(0)
    expect((await files.get('/Notes/Plan.md'))?.content).toBe('ship it')

    away()
    await files.remove('/Notes/Plan.md')
  })
})
