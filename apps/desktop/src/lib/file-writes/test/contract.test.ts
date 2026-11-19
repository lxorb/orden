import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => new Map<string, string>())
const told = vi.hoisted(() => [] as string[])
vi.mock('../../platform/src/api', () => ({
  onDisk: (path: string) => Promise.resolve(disk.has(path)),
  invoke: () => Promise.resolve(),
  oneWriteAt: <T>(_path: string, run: () => Promise<T>) => run(),
  writeInTurn: (path: string, words: string) => void disk.set(path, words),
  writeTaking: (path: string, words: string) => void disk.set(path, words),
}))
vi.mock('../../link-index/src/api', () => ({
  links: {
    noteSaved: (path: string) => told.push(`index ${path}`),
    cameBack: (path: string) => told.push(`back ${path}`),
  },
}))
vi.mock('../../documents/src/api', () => ({
  wroteHere: (path: string) => told.push(`across ${path}`),
}))
const { hearWrites, writeFile, writeIfAbsent } = await import('../src/api')
test('the module stands on its own reads the index, the documents and the platform through their apis only', () => {
  const text = readFileSync(join(import.meta.dirname, '../src/api.ts'), 'utf8')
  expect([...text.matchAll(/from '([^']*)'/g)].map((found) => found[1]).sort()).toEqual([
    '../../documents/src/api',
    '../../link-index/src/api',
    '../../platform/src/api',
  ])
})
describe('writing a file', () => {
  test('tells the index, the ear that listens and sync, a new file as made', async () => {
    const stop = hearWrites({
      there: (path) => Promise.resolve(disk.has(path)),
      made: (path) => {
        told.push(`made ${path}`)
        return Promise.resolve()
      },
      wrote: (path) => void told.push(`wrote ${path}`),
    })
    await writeFile('/s/Plan.md', 'one')
    await writeFile('/s/Plan.md', 'two')
    stop()
    expect(disk.get('/s/Plan.md')).toBe('two')
    expect(told.splice(0)).toEqual([
      'index /s/Plan.md',
      'made /s/Plan.md',
      'across /s/Plan.md',
      'index /s/Plan.md',
      'wrote /s/Plan.md',
      'across /s/Plan.md',
    ])
  })
  test('only if nothing is there yet', async () => {
    disk.set('/s/Kept.md', 'kept')
    expect(await writeIfAbsent('/s/Kept.md', 'new')).toBe(false)
    expect(await writeIfAbsent('/s/New.md', 'new')).toBe(true)
    expect(disk.get('/s/Kept.md')).toBe('kept')
    expect(told.splice(0)).toEqual(['index /s/New.md', 'across /s/New.md'])
  })
})
