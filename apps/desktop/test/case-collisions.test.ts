import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const TRACKED = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const MODULE_SUFFIXES = ['.svelte.ts', '.svelte.js']

function collisions(paths: readonly string[]): string[][] {
  const byFolded = new Map<string, string[]>()
  for (const path of paths) {
    const folded = path.toLowerCase()
    byFolded.set(folded, [...(byFolded.get(folded) ?? []), path])
  }
  return [...byFolded.values()].filter((same) => same.length > 1)
}

function shadowed(paths: readonly string[]): string[][] {
  const components = new Map<string, string>()
  for (const path of paths) {
    if (path.endsWith('.svelte')) components.set(path.toLowerCase(), path)
  }
  const found: string[][] = []
  for (const path of paths) {
    const suffix = MODULE_SUFFIXES.find((one) => path.endsWith(one))
    if (!suffix) continue
    const component = components.get(`${path.slice(0, -suffix.length)}.svelte`.toLowerCase())
    if (component) found.push([path, component])
  }
  return found
}

describe('files on a disk that ignores case', () => {
  test('no two tracked paths differ in case alone', () => {
    expect(collisions(TRACKED)).toEqual([])
  })

  test('a module never sits beside a component of the same name in another case', () => {
    expect(shadowed(TRACKED)).toEqual([])
  })

  test('the check knows the shape it refuses', () => {
    expect(collisions(['a/Setup.svelte', 'a/setup.svelte'])).toEqual([
      ['a/Setup.svelte', 'a/setup.svelte'],
    ])
    expect(shadowed(['a/Setup.svelte', 'a/setup.svelte.ts'])).toEqual([
      ['a/setup.svelte.ts', 'a/Setup.svelte'],
    ])
    expect(shadowed(['a/Setup.svelte', 'a/setup-state.svelte.ts'])).toEqual([])
    expect(shadowed(['a/account.svelte.ts', 'a/account.test.ts'])).toEqual([])
  })
})
