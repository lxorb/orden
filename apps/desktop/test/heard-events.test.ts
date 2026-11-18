import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'

const APP = join(import.meta.dirname, '..')

function filesUnder(
  dir: string,
  wanted: (name: string) => boolean,
  found: string[] = [],
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'target', 'dist'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) filesUnder(path, wanted, found)
    else if (wanted(entry.name)) found.push(path)
  }
  return found
}

const HEARD = /\b(?:listen|hearHere|once)(?:<[^>]*>)?\(\s*['"`]orden:\/\/([a-z0-9-]+)['"`]/g

test('every app event a page waits for is one the native side sends', () => {
  const native = [join(APP, 'src-tauri', 'src'), join(APP, 'src-tauri', 'crates')]
    .flatMap((dir) => filesUnder(dir, (name) => name.endsWith('.rs')))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  const unsent = filesUnder(join(APP, 'src'), (name) => /\.(ts|svelte)$/.test(name))
    .filter((file) => !file.endsWith('.test.ts'))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(HEARD)]
        .map((found) => found[1] ?? '')
        .filter((name) => !native.includes(`orden://${name}`))
        .map((name) => `orden://${name} in ${relative(APP, file)}`),
    )
  expect(unsent).toEqual([])
})
