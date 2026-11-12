import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('..', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../../../packages/themes/src/', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

const PANES = svelteFiles(LIB)
  .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
  .filter((one) => one.source.includes('orden-setting'))

const styleOf = (source: string) => /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? ''

const NOT_VALUES = [
  /placeholder="Search (settings|shortcuts|commands)"/,
  /class="title"/,
  /rows="12"/,
  /class="slider orden-slider"/,
]

describe('a setting', () => {
  test('is read in components that draw rows at all', () => {
    expect(PANES.map((one) => one.path)).toEqual(
      expect.arrayContaining([
        'SettingsPanel.svelte',
        'people/ProfileRows.svelte',
        'Security.svelte',
        'SyncPane.svelte',
        'AiPane.svelte',
      ]),
    )
  })

  test('draws no field of its own', () => {
    const own = PANES.filter(({ source }) => /class="[^"]*\binline\b|\.inline\b/.test(source))
    expect(own.map((one) => one.path)).toEqual([])
  })

  test('puts its value in the one column, not at a width of its own', () => {
    const widths = PANES.flatMap(({ path, source }) =>
      [...styleOf(source).matchAll(/(?<![-\w])(min-)?width:\s*1[24]rem/g)].map(
        (hit) => `${path}: ${hit[0]}`,
      ),
    )
    expect(widths).toEqual(['SettingsPanel.svelte: min-width: 12rem'])
  })

  test('types into the value box', () => {
    const bare = PANES.flatMap(({ path, source }) =>
      [...source.matchAll(/<(input|textarea)\b([^>]*?)\/?>/g)]
        .map((hit) => hit[2] ?? '')
        .filter((tag) => !/class="[^"]*\borden-field\b/.test(tag))
        .filter((tag) => !/type="(checkbox|range|color|file|hidden|radio)"/.test(tag))
        .filter((tag) => !NOT_VALUES.some((reason) => reason.test(tag)))
        .map((tag) => `${path}: ${tag.trim().split(/\s+/).slice(0, 3).join(' ')}`),
    )
    expect(bare).toEqual([expect.stringMatching(/^people\/ProfileRows\.svelte: value=\{status/)])
  })
})

describe('the value box', () => {
  const base = readFileSync(join(THEMES, 'base.css'), 'utf8')
  const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')

  test('is one column wide, said once', () => {
    expect(tokens).toMatch(/--setting-value:\s*14rem/)
    expect(base).toMatch(
      /\.orden-setting > \.orden-field\.is-value \{[^}]*inline-size:\s*var\(--setting-value\)/,
    )
  })

  test('is the shape the dropdown closes into as well', () => {
    const select = readFileSync(join(LIB, 'Select.svelte'), 'utf8')
    expect(select).toMatch(/class="trigger orden-field is-value"/)
    expect(styleOf(select)).not.toMatch(/\n {2}\.trigger \{[^}]*border:/)
  })
})

describe('Settings > Account', () => {
  const rows = readFileSync(join(LIB, 'people/ProfileRows.svelte'), 'utf8')
  const markup = rows.slice(rows.indexOf('</script>'))

  test('says what goes in every empty field', () => {
    for (const field of markup.match(/<(input|textarea)\b[^>]*>/g) ?? []) {
      expect(field).toMatch(/placeholder=/)
    }
  })

  test('keeps a status in one field, the emoji pressed inside it', () => {
    const status = /<span class="orden-field is-value">([\s\S]*?)<\/span>\n/.exec(markup)?.[1]
    expect(status).toMatch(/aria-label="Emoji"/)
    expect(status).toMatch(/aria-label="Status"/)
  })

  test('asks when a status clears only while there is one', () => {
    expect(markup).toMatch(
      /\{#if status\}\s*<div class="orden-setting setting">[\s\S]*?Clear after/,
    )
  })

  test('changes and removes a picture with the same kind of button', () => {
    const picture = markup.slice(markup.indexOf('>Picture<'), markup.indexOf('>Pronouns<'))
    const kinds = new Set([...picture.matchAll(/<button\s+class="([^"]+)"/g)].map((hit) => hit[1]))
    expect([...kinds]).toEqual(['orden-chip'])
  })
})
