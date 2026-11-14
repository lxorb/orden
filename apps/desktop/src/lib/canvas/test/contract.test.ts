import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { matches } from '../src/find'
import { RightPan } from '../src/right-pan'

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

  test('opens the canvas itself only through its door', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const loaded = [...api.matchAll(/from '([^']+)'/g)].map((one) => one[1])
    expect(loaded).not.toContain('./Canvas.svelte')
    expect(api).toMatch(/export const loadCanvas = \(\) =>[^;]*import\('\.\/Canvas\.svelte'\)/)
  })
})

const plane = {
  nodes: [
    {
      id: 'a',
      type: 'text' as const,
      text: 'Lecture  notes\non optics',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    },
    { id: 'b', type: 'file' as const, file: 'Optics.pdf', x: 200, y: 0, width: 100, height: 40 },
  ],
  edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'reads Optics' }],
  ink: [],
  at: {},
  gone: {},
}

describe('finding words on a plane', () => {
  test('meets cards and arrow labels in any case, with their words on one line', () => {
    expect(matches(plane, 'OPTICS')).toEqual([
      { id: 'a', says: 'Lecture notes on optics' },
      { id: 'b', says: 'Optics.pdf' },
      { id: 'e', says: 'reads Optics' },
    ])
  })

  test('finds nothing for nothing', () => {
    expect(matches(plane, '   ')).toEqual([])
  })
})

describe('a right-button drag', () => {
  const at = (x: number, extra: Partial<Parameters<RightPan['down']>[0]> = {}) => ({
    pointerId: 1,
    pointerType: 'mouse',
    button: 2,
    buttons: 2,
    clientX: x,
    clientY: 0,
    timeStamp: 0,
    ...extra,
  })

  test('pans once it is past the slop and leaves the menu to a click', () => {
    const pan = new RightPan()
    expect(pan.down(at(0))).toBe(true)
    expect(pan.move(at(2))).toBeNull()
    expect(pan.move(at(30))).toEqual({ dx: 30, dy: 0 })
    expect(pan.up(at(30, { buttons: 0 }))).toBe('panned')
  })

  test('takes no other button', () => {
    expect(new RightPan().down(at(0, { button: 0 }))).toBe(false)
  })
})
