import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const wrote = vi.hoisted(() => ({ times: 0 }))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    active: null,
    writeNow: () => {
      wrote.times++
      return Promise.resolve()
    },
  },
}))

const { askPlace, saveFront } = await import('../src/api')
const { placesFor } = await import('../src/places')

type Entry = NonNullable<Parameters<typeof placesFor>[0]>

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

  test('the api loads with the sheet closed, and every call is there', () => {
    for (const one of [askPlace, saveFront]) expect(typeof one).toBe('function')
  })
})

describe('saving the tab in front', () => {
  test('writes what is open when no tab waits for a place', () => {
    saveFront()
    expect(wrote.times).toBe(1)
  })
})

describe('where Save offers to put a tab', () => {
  const row = (path: string, children: Entry[] = []): Entry => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: children.length > 0,
    modified: 0,
    created: 0,
    children,
  })
  const tree = row('/space', [
    row('/space/Plan.md'),
    row('/space/Trips', [row('/space/Trips/a.md')]),
  ])
  const spaces = [
    { id: 's', name: 'Notes', root: '/space' },
    { id: 'w', name: 'Work', root: '/work' },
  ]

  test('everywhere a note could move to, the space first, and nowhere that cannot be written', () => {
    expect(placesFor(tree, spaces, '/space').map((one) => one.id)).toEqual([
      '/space',
      '/space/Plan',
      '/space/Trips',
      '/space/Trips/a',
      '/work',
    ])
    const writable = (path: string) => !path.startsWith('/work')
    expect(placesFor(tree, spaces, '/space', writable).map((one) => one.id)).not.toContain('/work')
  })
})
