import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../src/lib/', import.meta.url))

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return components(path)
    return one.name.endsWith('.svelte') ? [path] : []
  })
}

function layerOfList(source: string): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? ''
  return /\n {2}\.list \{[^}]*z-index: ([^;]*);/.exec(style)?.[1] ?? 'none'
}

test('a list hung outside its card is drawn above Settings and sheets, which it may open from', () => {
  const hung = components(LIB)
    .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
    .filter((one) =>
      /<ul[^>]*class="[^"]*\blist\b[^"]*"[^>]*role="listbox"[^>]*use:hang/s.test(one.source),
    )
  expect(hung.map((one) => one.path)).toEqual(
    expect.arrayContaining(['Select.svelte', join('settings', 'FontPicker.svelte')]),
  )
  const low = hung
    .filter((one) => layerOfList(one.source) !== 'var(--z-menu)')
    .map((one) => one.path)
  expect(low).toEqual([])
})
