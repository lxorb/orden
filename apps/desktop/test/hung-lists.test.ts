import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { svelte, walk } from './files'

const LIB = fileURLToPath(new URL('../src/lib/', import.meta.url))

function layerOfList(source: string): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? ''
  return /\n {2}\.list \{[^}]*z-index: ([^;]*);/.exec(style)?.[1] ?? 'none'
}

test('a list hung outside its card is drawn above Settings and sheets, which it may open from', () => {
  const hung = walk(LIB, svelte)
    .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
    .filter((one) =>
      /<ul[^>]*class="[^"]*\blist\b[^"]*"[^>]*role="listbox"[^>]*use:hang/s.test(one.source),
    )
  expect(hung.map((one) => one.path)).toEqual(
    expect.arrayContaining([
      join('ui-controls', 'src', 'Select.svelte'),
      join('settings', 'src', 'FontPicker.svelte'),
    ]),
  )
  const low = hung
    .filter((one) => layerOfList(one.source) !== 'var(--z-menu)')
    .map((one) => one.path)
  expect(low).toEqual([])
})
