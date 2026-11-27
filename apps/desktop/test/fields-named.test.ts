import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { svelte, walk } from './files'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const FIELD = /<(input|textarea|select)\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)>/g
const NEEDS_NO_WORDS = /type="(?:hidden|checkbox|radio|file|range|color)"/
const NAMED = /aria-label|aria-labelledby|\bid=|\{id\}|\{\.\.\./
function unnamed(source: string): number[] {
  const lines: number[] = []
  for (const found of source.matchAll(FIELD)) {
    const attributes = found[2] ?? ''
    if (NEEDS_NO_WORDS.test(attributes) || NAMED.test(attributes)) continue
    const before = source.slice(Math.max(0, found.index - 400), found.index)
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label')) continue
    lines.push(source.slice(0, found.index).split('\n').length)
  }
  return lines
}
describe('every field a person types into', () => {
  test('has a name a screen reader can say: a label, or an aria-label (#2286)', () => {
    const missing: string[] = []
    let seen = 0
    for (const path of walk(SRC, svelte)) {
      const source = readFileSync(path, 'utf8')
      seen += [...source.matchAll(FIELD)].length
      for (const line of unnamed(source)) missing.push(`${path.slice(SRC.length + 1).replaceAll('\\', '/')}:${line}`)
    }
    expect(seen).toBeGreaterThan(100)
    expect(missing).toEqual([])
  })
  test('the check tells a named field from a bare one', () => {
    expect(unnamed('<input placeholder="Search" />')).toEqual([1])
    expect(unnamed('<p>a</p>\n<textarea bind:value={text}></textarea>')).toEqual([2])
    expect(unnamed('<input aria-label="Search" />')).toEqual([])
    expect(unnamed('<label>Name <input bind:value={name} /></label>')).toEqual([])
    expect(unnamed('<label for={id}>Name</label><input {id} />')).toEqual([])
    expect(unnamed('<input type="checkbox" />')).toEqual([])
    expect(unnamed('<input onkeydown={(event) => { if (event.key === "a") go() }} />')).toEqual([1])
  })
})
