import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const APP = readFileSync(join(import.meta.dirname, '../src/App.svelte'), 'utf8')
const MAIN = /\n {2}main \{([^}]*)\}/.exec(APP)?.[1] ?? ''
test('the app leaves the band a window draws at its top out of its height, and a window with no band all of it', () => {
  expect(MAIN).toContain('height: calc(100dvh - var(--orden-band, 0px));')
  expect(MAIN).toContain('height: calc(100vh - var(--orden-band, 0px));')
  expect(MAIN).not.toMatch(/height:\s*100d?vh;/)
})
