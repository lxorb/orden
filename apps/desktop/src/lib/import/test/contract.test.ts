import type { PickedFile } from '@orden/contracts'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  applyImport,
  bringing,
  detect,
  folderNameFor,
  foundBrowsers,
  importingStore,
  insideFolder,
  landBrowser,
  landZen,
  loadImportSheet,
  loadMigrateRows,
  macNotes,
  migratingStore,
  pickedFolder,
  readAs,
  safeName,
  sourcesFrom,
  tidyPath,
  titleFrom,
  todoistAccount,
  tooMuch,
  vaults,
  vaultSources,
  zenProfiles,
} from '../src/api'
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads and every call is there', () => {
    for (const one of [
      applyImport,
      bringing,
      detect,
      foundBrowsers,
      importingStore,
      landBrowser,
      landZen,
      loadImportSheet,
      loadMigrateRows,
      macNotes,
      migratingStore,
      readAs,
      sourcesFrom,
      todoistAccount,
      vaults,
      vaultSources,
      zenProfiles,
    ]) {
      expect(typeof one).toBe('function')
    }
  })
})

const words = (body: string) => new TextEncoder().encode(body)

function picked(path: string, body: string): PickedFile {
  const bytes = words(body)
  return {
    name: path.split('/').pop() ?? path,
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

describe('what was picked', () => {
  test('a picked folder is named once and its files are read from inside it', () => {
    const files = [picked('Notes/a.md', '# A'), picked('Notes/sub/b.md', 'b')]
    expect(pickedFolder(files)).toBe('Notes')
    expect(insideFolder(files).map((one) => one.webkitRelativePath)).toEqual(['a.md', 'sub/b.md'])
  })

  test('paths are tidied to forward slashes with nothing in front', () => {
    expect(tidyPath('.\\Notes\\a.md')).toBe('Notes/a.md')
    expect(tidyPath('//a/b')).toBe('a/b')
  })

  test('a folder of markdown is read as markdown', async () => {
    const sources = await sourcesFrom(insideFolder([picked('Notes/a.md', '# A\n\nwords')]))
    expect(sources.map((one) => one.path)).toEqual(['a.md'])
    expect(await detect(sources)).not.toBeNull()
    expect(await detect([])).toBeNull()
  })

  test('a file too large to bring in is refused', () => {
    expect(tooMuch(0)).toBe(false)
    expect(tooMuch(Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})

describe('names', () => {
  test('a note is titled by its first heading and named without forbidden characters', () => {
    expect(titleFrom('\n# Plan\nmore')).toBe('Plan')
    expect(safeName('a/b: c?')).not.toMatch(/[/:?]/)
  })

  test('an import folder is named after what was picked, or the app an export came out of', () => {
    expect(folderNameFor([picked('Travel.enex', '')], 'evernote')).toBe('Travel')
    expect(folderNameFor([picked('Export-9f1c2d3e.zip', '')], 'notion')).toBe('Notion')
    expect(folderNameFor([picked('a.csv', '')], 'todoist')).toBe('')
  })
})
