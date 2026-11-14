import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { noteRowsOf } from '../src/store'

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

  test('names the rows store, what a row is read from and how one is written', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    for (const name of ['rows', 'noteRowsOf', 'changed', 'RowChange']) {
      expect(api).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })
})

describe('the rows of a note', () => {
  test('are the note and each of its tasks, anchored to their lines', () => {
    const found = noteRowsOf('s', 'Plan.md', '# Plan\n\n- [ ] call Ada\n- [x] book the room\n')
    expect(found.map((one) => [one.kind, one.space, one.path])).toEqual([
      ['note', 's', 'Plan.md'],
      ['task', 's', 'Plan.md'],
      ['task', 's', 'Plan.md'],
    ])
    expect(found.filter((one) => one.kind === 'task').map((one) => one.anchor?.line)).toEqual([
      2, 3,
    ])
  })

  test('are only the note when it holds no task', () => {
    expect(noteRowsOf('s', 'Notes/Idea.md', 'words').map((one) => one.kind)).toEqual(['note'])
  })
})
