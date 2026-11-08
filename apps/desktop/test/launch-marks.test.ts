import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SRC = join(ROOT, 'apps', 'desktop', 'src')

const TRACE = readFileSync(join(SRC, 'lib', 'trace.ts'), 'utf8')
const PREFIX = /performance\.mark\(`([^`$]*)\$\{step\}`\)/.exec(TRACE)?.[1] ?? ''

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((one) => one.isFile() && keep(one.name))
    .map((one) => join(one.parentPath, one.name))
}

const marking = walk(SRC, (name) => /\.(ts|svelte)$/.test(name) && !name.includes('.test.'))
  .map((path) => readFileSync(path, 'utf8'))
  .filter((text) => /from '[./]*(lib\/)?trace'/.test(text))

const STEPS = new Set(
  marking.flatMap((text) =>
    [...text.matchAll(/\bmark(?:Painted)?\('([^']+)'\)/g)].map((found) => found[1] ?? ''),
  ),
)

const DRIVES = [
  ...walk(join(ROOT, 'apps', 'desktop', 'test', 'e2e'), (name) => name.endsWith('.py')),
  ...walk(join(ROOT, 'scripts'), (name) => /\.(py|mjs|ts|sh)$/.test(name)),
].map((path) => ({ path: path.slice(ROOT.length), text: readFileSync(path, 'utf8') }))

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('the launch marks a drive waits for', () => {
  test('come from one prefix in trace.ts', () => {
    expect(PREFIX).toMatch(/^\w+: $/)
    expect(STEPS).toContain('launch order finished')
    expect(STEPS).toContain('start')
  })

  test('are named with the prefix the app marks them with', () => {
    const steps = [...STEPS].map(escaped).join('|')
    const named = new RegExp(
      `(?:getEntriesByName\\(|marks\\.get\\(|LAUNCHED = )(['"])(\\w+): (${steps})\\1`,
      'g',
    )
    const wrong = DRIVES.flatMap(({ path, text }) =>
      [...text.matchAll(named)]
        .filter((found) => `${found[2]}: ` !== PREFIX)
        .map((found) => `${path}: ${found[0]}`),
    )

    expect(wrong).toEqual([])
  })

  test('and a drive that lists them all strips exactly that prefix', () => {
    const listed = /\.startsWith\((['"])(\w+: )\1\)\)?[\s\S]{0,120}?\.slice\((\d+)\)/g
    const found = DRIVES.flatMap(({ path, text }) =>
      [...text.matchAll(listed)].map((one) => ({ path, prefix: one[2], cut: Number(one[3]) })),
    )

    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((one) => one.prefix !== PREFIX || one.cut !== PREFIX.length)).toEqual([])
  })
})
