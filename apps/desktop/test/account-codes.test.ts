import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCES = ['../src/lib/Security.svelte', '../src/lib/DeleteAccount.svelte'].map((one) =>
  readFileSync(fileURLToPath(new URL(one, import.meta.url)), 'utf8'),
)

const labels = SOURCES.flatMap((source) =>
  [...source.matchAll(/<input\b[^>]*?aria-label="([^"]+)"[^>]*?one-time-code/g)].map(
    ([, label]) => label,
  ),
)

test('every code field on the Account pane is named for what it does', () => {
  expect(labels.sort()).toEqual([
    'App code to delete',
    'Code',
    'Code from the app',
    'Code to change sign-in',
  ])
})

test('and no two of them are named alike', () => {
  expect(new Set(labels).size).toBe(labels.length)
})
