import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, './TerminalTab.svelte'), 'utf8')
const XTERM = readFileSync(
  createRequire(import.meta.url).resolve('@xterm/xterm/css/xterm.css'),
  'utf8',
)

test("xterm.js's viewport is black, and the terminal takes the black off", () => {
  expect(XTERM).toMatch(/\.xterm \.xterm-viewport \{[^}]*background-color: #000/)
  expect(SOURCE).toMatch(/:global\(\.xterm-viewport\) \{\s*background-color: transparent;/)
})
