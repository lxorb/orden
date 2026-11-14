import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  baseMounting,
  baseOpening,
  builtinName,
  createDatabase,
  loadViewTab,
  orderMoved,
  pickTemplate,
  readSpec,
  rowsCopied,
  startRunner,
  writeSpec,
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

  test('loads only the spec a view tab holds with it, and the rest through doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const loaded = [...api.matchAll(/^export \{[^}]*\} from '([^']+)'/gm)].map((one) => one[1])
    expect(loaded).toEqual(['./spec'])
    const doors = [
      loadViewTab,
      startRunner,
      baseOpening,
      baseMounting,
      rowsCopied,
      createDatabase,
      pickTemplate,
      orderMoved,
    ]
    for (const one of doors) expect(typeof one).toBe('function')
  })
})

describe('the spec a view tab holds', () => {
  test('is read back as it was written, in a fixed order and with nothing unknown', () => {
    const spec = { yaml: 'views: []', path: '/s/Tasks.base', space: 's', view: 'Board' }
    const words = writeSpec(spec)
    expect(words).toBe('{"space":"s","path":"/s/Tasks.base","view":"Board","yaml":"views: []"}')
    expect(readSpec(words)).toEqual(spec)
    expect(readSpec('{"builtin":"todos","odd":1,"tag":3}')).toEqual({ builtin: 'todos' })
  })

  test('is nothing when the words are not a record', () => {
    expect(readSpec('not json')).toBeNull()
    expect(readSpec('[1]')).toBeNull()
  })

  test('names the built-in views', () => {
    expect(builtinName('todos')).toBe('Todos')
  })
})
