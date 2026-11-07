import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, './SettingsPanel.svelte'), 'utf8')

const RULE = /\.setting \.nib-segmented \{([^}]*)\}/.exec(SOURCE)?.[1]

describe('a segmented setting', () => {
  test('is never narrower than the column its short choices line up in, while the row is wider', () => {
    expect(RULE).toMatch(/min-width:\s*min\(var\(--setting-value\),\s*100%\)/)
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
