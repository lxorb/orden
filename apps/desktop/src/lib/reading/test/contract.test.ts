import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { headingOffsets, positionOf, sectionAt } from '../src/places'

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
})

describe('a place in a note read', () => {
  const offsets = [0, 100, 260]

  test('is the section it is in and how far through it, and back again', () => {
    expect(sectionAt(180, offsets, 600)).toEqual({ index: 1, fraction: 0.5 })
    expect(positionOf({ index: 1, fraction: 0.5 }, offsets, 600)).toBe(180)
  })

  test('before the first heading is no section, and a note with none is one long section', () => {
    expect(sectionAt(-40, [40, 100], 600)).toEqual({ index: -1, fraction: 0 })
    expect(sectionAt(250, [], 1000)).toEqual({ index: -1, fraction: 0.25 })
  })

  test('starts its sections at the headings, never at one inside a code block', () => {
    const note = '# One\n\ntext\n\n```\n# not\n```\n\n## Two\n'
    expect(headingOffsets(note)).toEqual([0, note.indexOf('## Two')])
  })
})
