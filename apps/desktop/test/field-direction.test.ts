import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))
const SHEET = fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

test('every field reads each line in the direction of its words, its placeholder in the app’s', () => {
  const sheet = readFileSync(SHEET, 'utf8')
  expect(sheet).toMatch(/textarea,\s*input:is\([\s\S]*?\)\s*\{\s*unicode-bidi:\s*plaintext;/)

  const fixed = svelteFiles(SOURCE).filter((path) =>
    /<(?:textarea|input)\b[^>]*\bdir="auto"/.test(readFileSync(path, 'utf8')),
  )
  expect(fixed).toEqual([])
})

test('a name alone in its label is laid out in its own direction, so a cut-off keeps its start', () => {
  const alone =
    /<(span|p|div|strong)\b(?:[^>{]|\{[^}]*\})*>\s*<bdi>\{[^<]*\}<\/bdi\s*>\s*<\/\1\s*>/g
  const isolated = svelteFiles(SOURCE).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(alone)].map(
      (one) => `${path.slice(SOURCE.length)}: ${one[0].replace(/\s+/g, ' ')}`,
    ),
  )
  expect(isolated).toEqual([])
})

test('no name sits in a bare bdi, whose clipped label would keep the app’s direction and cut its start', () => {
  const bare = svelteFiles(SOURCE).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/<bdi\s*>/g)].map(() => path.slice(SOURCE.length)),
  )
  expect(bare).toEqual([])
})
