import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(
  fileURLToPath(new URL('./SettingsPanel.svelte', import.meta.url)),
  'utf8',
)

const RULE = /\.setting \.nib-segmented \{([^}]*)\}/.exec(SOURCE)?.[1]

describe('a segmented setting', () => {
  test('is never narrower than the column its short choices line up in', () => {
    expect(RULE).toMatch(/min-width:\s*var\(--setting-value\)/)
  })

  test('and grows to its words rather than holding them to one width', () => {
    expect(RULE).not.toMatch(/(^|[\s;])width:/)
  })
})

describe('a generated pane', () => {
  test('keys its groups, rows and sides by something no translation can make equal', () => {
    expect(SOURCE.match(/\{#each [^}]*\(\w+\.(label|title)\)\}/g)).toBeNull()
  })
})
