import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../src/lib', import.meta.url))

const SMALL = ['overview/mirror.ts', 'tab-strip/thumb.ts', 'wallpaper/render.ts']

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(one.name) && !one.name.endsWith('.test.ts') ? [path] : []
  })
}

test('a picture of any size is encoded off the window’s thread, never by toDataURL', () => {
  const found = sources(LIB)
    .map((path) => relative(LIB, path).replaceAll('\\', '/'))
    .filter((path) => readFileSync(join(LIB, path), 'utf8').includes('.toDataURL('))
  expect(found.filter((path) => !SMALL.includes(path))).toEqual([])
  expect(SMALL.filter((path) => !found.includes(path))).toEqual([])
})
