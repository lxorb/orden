import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Importer, providePort } from '@orden/contracts'
import { beginSetup, gate, loadGuide, loadSetup } from '../src/api'
import { bringing } from '../src/bring'
import { BROWSERS } from '../src/catalog'
import { type Reach, stepAfter } from '../src/flow'

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

  test('the setup and the guide open, and the setup begins, through doors', () => {
    for (const one of [loadSetup, loadGuide, beginSetup]) expect(typeof one).toBe('function')
    expect(gate.showing).toBe(false)
    expect(gate.guiding).toBe(false)
  })
})

const reach = (here: ReadonlySet<Importer>): Reach => ({
  signedIn: true,
  importable: (id) => {
    const importer = BROWSERS.find((one) => one.id === id)?.importer ?? null
    return importer !== null && here.has(importer)
  },
  signIns: true,
  phone: false,
  heard: true,
  connected: false,
})

const answers = { browser: 'chrome', notes: null, code: null }

describe('what the setup asks of import', () => {
  test('finds and brings nothing while no module lends the import', async () => {
    expect([...(await bringing().here())]).toEqual([])
    expect(await bringing().browser('chrome')).toEqual([])
    expect(await bringing().notes('folder')).toEqual({ picked: false, trouble: null })
    expect(stepAfter('browser', answers, reach(await bringing().here()))).not.toBe('import')
  })

  test('offers to import a browser the port finds here, and tells what the port brought', async () => {
    const brought: string[] = []
    const unbind = providePort('import.bring', {
      here: () => Promise.resolve(new Set<Importer>(['chrome'])),
      browser: (importer) => {
        brought.push(importer)
        return Promise.resolve(['1 bookmark could not be read'])
      },
      notes: () => Promise.resolve({ picked: true, trouble: null }),
    })
    expect(stepAfter('browser', answers, reach(await bringing().here()))).toBe('import')
    expect(await bringing().browser('chrome')).toEqual(['1 bookmark could not be read'])
    expect(brought).toEqual(['chrome'])
    expect(await bringing().notes('vault')).toEqual({ picked: true, trouble: null })
    unbind()
    expect(await bringing().notes('vault')).toEqual({ picked: false, trouble: null })
  })
})
