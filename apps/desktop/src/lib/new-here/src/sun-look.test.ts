import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const SUN = readFileSync(join(import.meta.dirname, 'Sun.svelte'), 'utf8')
const style = SUN.slice(SUN.indexOf('<style>'))
test('the middle is drawn like any wedge, never green or glowing when the wheel opens (#2557)', () => {
  expect(style).not.toMatch(/\.hub\.picked/)
  const hub = /\.hub \{[^}]*\}/.exec(style)?.[0] ?? ''
  expect(hub).not.toContain('--accent')
  expect(hub).not.toContain('box-shadow')
})
