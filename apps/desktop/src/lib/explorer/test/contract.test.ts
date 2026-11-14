import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  carry,
  changeable,
  inASpace,
  listFolder,
  loadExplorerTab,
  makeIn,
  moved,
  openExplorer,
  redoOutside,
  showInExplorer,
  undoOutside,
  viewOf,
} from '../src/api'
import type { Entry } from '../src/commands'
import { crumbsOf, parentOf } from '../src/crumbs'
import { ordered } from '../src/order'
import { readSpec, steppedBack, steppedForward, wentTo, writeSpec } from '../src/spec'
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
      carry,
      changeable,
      inASpace,
      listFolder,
      loadExplorerTab,
      makeIn,
      moved,
      openExplorer,
      redoOutside,
      showInExplorer,
      undoOutside,
      viewOf,
    ]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('a folder', () => {
  test('is a crumb for every step from the top of the disk', () => {
    expect(crumbsOf('/home/me').map((one) => one.path)).toEqual(['/', '/home', '/home/me'])
    expect(parentOf('/home/me')).toBe('/home')
  })

  test('lists folders first, names as a person counts them, and hidden files only when asked', () => {
    const entry = (name: string, more: Partial<Entry> = {}): Entry => ({
      name,
      kind: 'file',
      folder: false,
      size: 0,
      modified: 0,
      created: 0,
      hidden: false,
      ...more,
    })
    const entries = [
      entry('b 10.txt'),
      entry('b 2.txt'),
      entry('Zeta', { kind: 'folder', folder: true }),
      entry('.hidden', { hidden: true }),
    ]
    const names = (hidden: boolean) =>
      ordered(entries, { key: 'name', down: false }, hidden).map((one) => one.name)
    expect(names(false)).toEqual(['Zeta', 'b 2.txt', 'b 10.txt'])
    expect(names(true)).toContain('.hidden')
  })
})

describe('the way back and forward', () => {
  test('is kept in the tab and survives being written and read again', () => {
    const start = { folder: '/a', back: [], ahead: [] }
    const there = wentTo(wentTo(start, '/b'), '/c')
    const back = steppedBack(there)
    expect(back).toEqual({ folder: '/b', back: ['/a'], ahead: ['/c'] })
    expect(back && steppedForward(back)).toEqual(there)
    expect(readSpec(writeSpec(there))).toEqual(there)
    expect(readSpec('not json')).toBeNull()
    expect(steppedBack(start)).toBeNull()
  })
})
