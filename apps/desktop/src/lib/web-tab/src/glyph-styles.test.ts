import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from 'svelte/compiler'
import { expect, test } from 'vitest'

const HERE = import.meta.dirname
test('every rule for an icon in a web tab’s parts reaches it, so no icon is drawn at its own full size', () => {
  const unused = readdirSync(HERE)
    .filter((name) => name.endsWith('.svelte'))
    .flatMap((name) => {
      const { warnings } = compile(readFileSync(join(HERE, name), 'utf8'), { filename: name, generate: false })
      return warnings
        .filter((one) => one.code === 'css_unused_selector' && /\bsvg\b/.test(one.message))
        .map((one) => `${name}: ${one.message}`)
    })
  expect(unused).toEqual([])
})
test('an icon draws at the icon size, stroked and unfilled, with no rule of its holder needed, and any holder may still size it', () => {
  const { css } = compile(readFileSync(join(HERE, 'Glyph.svelte'), 'utf8'), {
    filename: 'Glyph.svelte',
    css: 'external',
  })
  const rule = /:where\(svg\.orden-web-glyph\)\s*\{([^}]*)\}/.exec(css?.code ?? '')?.[1] ?? ''
  expect(rule).toMatch(/width:\s*var\(--icon-md\)/)
  expect(rule).toMatch(/height:\s*var\(--icon-md\)/)
  expect(rule).toMatch(/fill:\s*none/)
  expect(rule).toMatch(/stroke:\s*currentColor/)
})
test('the icon’s own class is its alone, so its defaults reach no other svg in the window', () => {
  const SRC = join(HERE, '../../..')
  const users = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.svelte') || path.endsWith('.css'))
    .filter((path) => readFileSync(join(SRC, path), 'utf8').includes('orden-web-glyph'))
    .map((path) => path.replaceAll('\\', '/'))
  expect(users).toEqual(['lib/web-tab/src/Glyph.svelte'])
})
