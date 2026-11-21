import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { PICTURE_TALLEST, PICTURE_WIDEST } from './media'

const row = readFileSync(join(import.meta.dirname, 'MessageRow.svelte'), 'utf8')
test('a picture written into a message is held to the same 320 by 360 as an attached one, and opens whole on a click (#2448)', () => {
  expect([PICTURE_WIDEST, PICTURE_TALLEST]).toEqual([320, 360])
  expect(row).toMatch(/style:--picture-widest="\{PICTURE_WIDEST\}px"/)
  expect(row).toMatch(/style:--picture-tallest="\{PICTURE_TALLEST\}px"/)
  const rule = /\.body :global\(img\) \{([^}]*)\}/.exec(row)?.[1] ?? ''
  expect(rule).toMatch(/max-width: min\(100%, var\(--picture-widest\)\)/)
  expect(rule).toMatch(/max-height: var\(--picture-tallest\)/)
  expect(rule).toMatch(/width: auto/)
  expect(rule).toMatch(/height: auto/)
  expect(row).toMatch(/closest\('img'\)[\s\S]*followHref\(picture\.currentSrc, event\)/)
})
