import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { SOURCE, svelte, walk } from './files'

const SOURCES = ['../src/lib/accounts-ui/src/Security.svelte', '../src/lib/accounts-ui/src/DeleteAccount.svelte'].map(
  (one) => readFileSync(fileURLToPath(new URL(one, import.meta.url)), 'utf8'),
)
const labels = SOURCES.flatMap((source) =>
  [...source.matchAll(/<input\b[^>]*?aria-label="([^"]+)"[^>]*?one-time-code/g)].map(([, label]) => label),
)
test('every code field on the Account pane is named for what it does', () => {
  expect(labels.sort()).toEqual(['App code to delete', 'Code', 'Code from the app', 'Code to change sign-in'])
})
test('and no two of them are named alike', () => {
  expect(new Set(labels).size).toBe(labels.length)
})
test('a sign-in code is typed into one field wherever it is asked for, never into six that pass focus on', () => {
  const passing = walk(SOURCE, svelte).filter((path) =>
    /index === 0 \? 'one-time-code'|aria-label="Digit \{/.test(readFileSync(path, 'utf8')),
  )
  expect(passing).toEqual([])
  for (const one of ['../src/lib/accounts-ui/src/SignIn.svelte', '../src/lib/sign-in/src/SignIn.svelte']) {
    expect(readFileSync(fileURLToPath(new URL(one, import.meta.url)), 'utf8'), one).toContain('<CodeBoxes ')
  }
})
