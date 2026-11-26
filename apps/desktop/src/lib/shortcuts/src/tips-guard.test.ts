import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const LIB = join(import.meta.dirname, '../..')
const NATIVE = [
  /\btitle=\{[^}\n]*shortcuts\./,
  /\btitle=\{[^}\n]*\b(?:hint|keyFor)\(/,
  /\buse:tip=\{[^}\n]*shortcuts\./,
  /\.tooltip\(/,
  /setAttribute\(\s*['"]title['"][^)\n]*shortcuts\./,
]
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}
describe('a shortcut on a button', () => {
  test('is shown by the Orden tooltip, never by the browser’s own title', () => {
    const files = sources(LIB)
    expect(files.length).toBeGreaterThan(500)
    const found = files.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, at) =>
          NATIVE.some((rule) => rule.test(line)) ? [`${relative(LIB, path)}:${at + 1}: ${line.trim()}`] : [],
        ),
    )
    expect(found).toEqual([])
  })
})
