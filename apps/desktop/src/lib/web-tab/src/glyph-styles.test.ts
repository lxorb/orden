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
