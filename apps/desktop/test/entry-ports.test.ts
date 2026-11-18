import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const APP = join(import.meta.dirname, '..')
const ROOT = join(APP, '..', '..')

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g
const STATIC =
  /(?:^|[\n;}])[^\S\n]*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\n;}])[^\S\n]*import\s*['"]([^'"]+)['"]/g
const LAZY = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const PROVIDED = /\bprovidePort\(\s*['"]([^'"]+)['"]/g
const NEEDED = /\bneedPort\(\s*['"]([^'"]+)['"]/g

const text = (file: string) =>
  readFileSync(file, 'utf8').replace(COMMENTS, (_whole, head?: string) => head ?? '')

function packageFile(specifier: string): string | null {
  const found = /^@orden\/([^/]+)(\/.*)?$/.exec(specifier)
  if (!found?.[1]) return null
  const folder = join(ROOT, 'packages', found[1])
  if (!existsSync(join(folder, 'package.json'))) return null
  const exports = (
    JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
      exports?: Record<string, string | Record<string, string>>
    }
  ).exports
  const target = exports?.[found[2] ? `.${found[2]}` : '.']
  const path = typeof target === 'string' ? target : (target?.import ?? target?.default)
  return path === undefined ? null : resolve(folder, path)
}

function relativeFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const tries = [base, `${base}.ts`, `${base}.svelte`, `${base}.js`, join(base, 'index.ts')]
  return tries.find((one) => existsSync(one) && statSync(one).isFile()) ?? null
}

function imported(file: string, lazy: boolean): string[] {
  const source = text(file)
  const asked = [...source.matchAll(STATIC)]
    .filter((one) => !/\b(?:import|export)\s+type\b/.test(one[0]))
    .map((one) => one[1] ?? one[2] ?? '')
  if (lazy) asked.push(...[...source.matchAll(LAZY)].map((one) => one[1] ?? ''))
  return asked.flatMap((specifier) => {
    const bare = specifier.replace(/\?.*$/, '')
    if (bare !== specifier || bare.endsWith('.css')) return []
    const found = bare.startsWith('.') ? relativeFile(file, bare) : packageFile(bare)
    return found && /\.(?:ts|svelte|js)$/.test(found) ? [found] : []
  })
}

function graph(starts: readonly string[], lazy: boolean): string[] {
  const seen = new Set<string>()
  const queue = [...starts]
  while (queue.length) {
    const file = queue.shift()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    queue.push(...imported(file, lazy))
  }
  return [...seen]
}

const PORT_FILES = join(APP, 'src', 'lib')

const names = (files: readonly string[], pattern: RegExp) =>
  files.flatMap((file) => [...text(file).matchAll(pattern)].map((one) => [one[1] ?? '', file]))

const PAGES = readdirSync(APP)
  .filter((name) => name.endsWith('.html'))
  .map((page): [string, string[]] => [
    page,
    [
      ...readFileSync(join(APP, page), 'utf8').matchAll(/<script type="module" src="\/([^"]+)"/g),
    ].map((one) => join(APP, one[1] ?? '')),
  ])

const ENTRIES: [string, string[]][] = [...PAGES, ['site', [join(APP, 'src', 'site', 'site.ts')]]]

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourcesUnder(path, found)
    else if (/\.(?:ts|svelte)$/.test(entry.name)) found.push(path)
  }
  return found
}

describe('the ports an entry needs', () => {
  test('every page the app builds is read', () => {
    expect(PAGES.map(([page]) => page)).toEqual(
      expect.arrayContaining([
        'index.html',
        'even.html',
        'pass.html',
        'quick-add.html',
        'handoff.html',
      ]),
    )
    for (const [, starts] of ENTRIES) expect(starts.length).toBeGreaterThan(0)
  })

  test.each(ENTRIES)('%s binds at startup every port its code may need', (_page, starts) => {
    const bound = new Set(names(graph(starts, false), PROVIDED).map(([port]) => port))
    const unbound = names(graph(starts, true), NEEDED)
      .filter(([port]) => !bound.has(port ?? ''))
      .map(([port, file]) => `${port} in ${relative(ROOT, file ?? '')}`)
    expect([...new Set(unbound)]).toEqual([])
  })

  test.each(ENTRIES)('%s imports itself every port file it loads at startup', (_page, starts) => {
    const own = new Set(starts.flatMap((start) => imported(start, false)))
    const reached = graph(starts, false)
      .filter((file) => dirname(file) === PORT_FILES && file.endsWith('-ports.ts'))
      .filter((file) => !own.has(file))
      .map((file) => relative(ROOT, file))
    expect(reached).toEqual([])
  })

  test('every needPort names its port where it asks', () => {
    const vague = [join(APP, 'src'), join(ROOT, 'packages')]
      .flatMap((dir) => sourcesUnder(dir))
      .filter((file) => /\bneedPort\(\s*[^'"\s]/.test(text(file)))
      .map((file) => relative(ROOT, file))
    expect(vague).toEqual([])
  })
})
