import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const read = (path: string) => readFileSync(join(import.meta.dirname, '../src/lib', path), 'utf8')
const layer = (text: string) => /\.shell\s*\{[^}]*z-index:\s*([^;]+);/.exec(text)?.[1]?.trim()
test('the join shell lies under the join sheet, so a question or a failed join is never hidden behind it (#2476)', () => {
  expect(read('sharing/src/JoinSheet.svelte')).toContain('z-index: var(--z-screen);')
  expect(layer(read('sharing/src/JoinShell.svelte'))).toBe('calc(var(--z-screen) - 1)')
})
