import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => new Map<string, string>())
const told = vi.hoisted(() => [] as string[])
const asked = vi.hoisted(() => [] as { command: string; args: Record<string, unknown> }[])
vi.mock('../../platform/src/api', () => ({
  onDisk: (path: string) => Promise.resolve(disk.has(path)),
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, args })
    return Promise.resolve(command === 'save_asset' ? `${String(args.folder)}/${String(args.name)}` : undefined)
  },
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
const { hearWrites, saveAsset, writeBy, writeFile, writeIfAbsent } = await import('../src/api')
const listening = () =>
  hearWrites({
    there: (path) => Promise.resolve(disk.has(path)),
    made: (path) => {
      told.push(`made ${path}`)
      return Promise.resolve()
    },
    wrote: (path, content) => void told.push(`wrote ${path} ${content}`),
  })
test('the module stands on its own reads the index, the documents, the platform and the sidecar name through their apis only', () => {
  const text = readFileSync(join(import.meta.dirname, '../src/api.ts'), 'utf8')
  expect([...text.matchAll(/from '([^']*)'/g)].map((found) => found[1]).sort()).toEqual([
    '../../documents/src/api',
    '../../link-index/src/api',
    '../../platform/src/api',
    '@orden/markdown/links',
  ])
})
test('only this module writes a file by save_asset, write_bytes or write_highlights, so every such file reaches sync', () => {
  const lib = join(import.meta.dirname, '../..')
  const writers = ['file-writes/src/', 'web-backend/src/', 'sync-client/src/', 'crate/src/native.ts']
  const found = readdirSync(lib, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter((path) => /\.(ts|svelte)$/.test(path) && !path.endsWith('.test.ts') && !path.includes('/test/'))
    .filter((path) => !writers.some((one) => path.startsWith(one)))
    .filter((path) => /['"`](save_asset|write_bytes|write_highlights)['"`]/.test(readFileSync(join(lib, path), 'utf8')))
  expect(found).toEqual([])
})
describe('writing a file', () => {
  test('tells the index, the ear that listens and sync, a new file as made', async () => {
    const stop = listening()
    await writeFile('/s/Plan.md', 'one')
    await writeFile('/s/Plan.md', 'two')
    stop()
    expect(disk.get('/s/Plan.md')).toBe('two')
    expect(told.splice(0)).toEqual([
      'index /s/Plan.md',
      'made /s/Plan.md',
      'across /s/Plan.md',
      'index /s/Plan.md',
      'wrote /s/Plan.md two',
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
  test('by any command, a new file is told as made and a file that was there as written', async () => {
    const stop = listening()
    const write = (words: string) => () => {
      disk.set('/s/paper.pdf.highlights.json', words)
      return Promise.resolve()
    }
    await writeBy('/s/paper.pdf.highlights.json', 'one', write('one'))
    await writeBy('/s/paper.pdf.highlights.json', 'two', write('two'))
    stop()
    expect(told.splice(0)).toEqual(['made /s/paper.pdf.highlights.json', 'wrote /s/paper.pdf.highlights.json two'])
  })
})
describe('saving a file beside a note', () => {
  test('returns where the note links it and tells the ear the whole path, out of the folder too', async () => {
    const stop = listening()
    const bytes = new Uint8Array([1, 2])
    expect(await saveAsset('/s/ideas/Plan.md', 'assets', 'p.png', bytes)).toBe('assets/p.png')
    expect(await saveAsset('/s/ideas/deep/Plan.md', '../../assets', 'minutes.pdf', bytes)).toBe(
      '../../assets/minutes.pdf',
    )
    expect(await saveAsset('/s/ideas/Plan.md', '../assets', 'q.png', bytes)).toBe('../assets/q.png')
    stop()
    expect(told.splice(0)).toEqual(['made /s/ideas/assets/p.png', 'made /s/assets/minutes.pdf', 'made /s/assets/q.png'])
    expect(asked.splice(0).map((one) => one.command)).toEqual(['save_asset', 'save_asset', 'save_asset'])
  })
  test('tells nothing where nobody listens', async () => {
    expect(await saveAsset('/s/Plan.md', 'assets', 'p.png', new Uint8Array([1]))).toBe('assets/p.png')
    expect(told.splice(0)).toEqual([])
  })
})
