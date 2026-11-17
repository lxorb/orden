import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, 'Select.svelte'), 'utf8')

describe('a list of choices as long as the languages, each named in its own script', () => {
  test('lays out only the rows in sight, so opening it loads no font a row out of sight needs', () => {
    const rows = /\.list li,\s*\.sheet li \{([^}]*)\}/.exec(SOURCE)?.[1] ?? ''
    expect(rows).toMatch(/content-visibility:\s*auto/)
    expect(rows).toMatch(/contain-intrinsic-size:\s*auto \d+px/)
  })
})
