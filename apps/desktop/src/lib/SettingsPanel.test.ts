import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, './SettingsPanel.svelte'), 'utf8')

const RULE = /\.setting \.orden-segmented \{([^}]*)\}/.exec(SOURCE)?.[1]

describe('a segmented setting', () => {
  test('is never narrower than the column its short choices line up in, while the row is wider', () => {
    expect(RULE).toMatch(/min-width:\s*min\(var\(--setting-value\),\s*100%\)/)
  })

  test('and grows to its words rather than holding them to one width', () => {
    expect(RULE).not.toMatch(/(^|[\s;])width:/)
  })
})

describe('the open pane', () => {
  test('is named by a second-level heading over its third-level groups, on a phone as beside the list', () => {
    const named = [...SOURCE.matchAll(/<(h\d)>\{titleOf\(settings\.section\)\}<\/\1>/g)].map(
      (one) => one[1],
    )
    expect(named.length).toBeGreaterThan(1)
    expect(new Set(named)).toEqual(new Set(['h2']))
  })
})

describe('a generated pane', () => {
  test('keys its groups, rows and sides by something no translation can make equal', () => {
    expect(SOURCE.match(/\{#each [^}]*\(\w+\.(label|title)\)\}/g)).toBeNull()
  })
})
