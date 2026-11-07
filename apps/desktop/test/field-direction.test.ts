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
