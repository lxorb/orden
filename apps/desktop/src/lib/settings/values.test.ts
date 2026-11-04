import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The value at the end of a setting's row is one box in one column (#1056).
 *
 *  Settings > Account had a name drawn as plain text, an address in grey, two empty
 *  boxes and a dropdown of another height, each ending at its own x, because every
 *  pane carried its own copy of the field: a borderless `.inline` at 12rem in four of
 *  them and 14rem in a fifth, and a `.pick` of 14rem for the dropdown in four more.
 *  The box is `.nib-field.is-value` in the themes package and the column is
 *  `--setting-value`; these read every component that draws a setting's row and
 *  refuse the shapes that let them drift again.
 *
 *  Read out of the sources rather than measured, for the reason Editor.test.ts gives.
 *  What it looks like is the drives' question. */

const LIB = fileURLToPath(new URL('..', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../../../packages/themes/src/', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

/** Every component that draws a setting's row. */
const PANES = svelteFiles(LIB)
  .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
  .filter((one) => one.source.includes('nib-setting'))

const styleOf = (source: string) => /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? ''

/** The fields in a row that are not the value box, each for a reason of its own: the
 *  three searches are inside a `.nib-field` wrapper, a header's name is a title
 *  rather than a value, and a space's instructions are a page of text. */
const NOT_VALUES = [
  /placeholder=\{t\('Search (settings|shortcuts|commands)'\)\}/,
  /class="title"/,
  /rows="12"/,
  /class="slider nib-slider"/,
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
    // The one left is a clash's sentence beside its two answers, which is words.
    expect(widths).toEqual(['SettingsPanel.svelte: min-width: 12rem'])
  })

  test('types into the value box', () => {
    const bare = PANES.flatMap(({ path, source }) =>
      [...source.matchAll(/<(input|textarea)\b([^>]*?)\/?>/g)]
        .map((hit) => hit[2] ?? '')
        .filter((tag) => !/class="[^"]*\bnib-field\b/.test(tag))
        .filter((tag) => !/type="(checkbox|range|color|file|hidden|radio)"/.test(tag))
        .filter((tag) => !NOT_VALUES.some((reason) => reason.test(tag)))
        .map((tag) => `${path}: ${tag.trim().split(/\s+/).slice(0, 3).join(' ')}`),
    )
    // The status's words, which stand in the value box beside its emoji.
    expect(bare).toEqual([expect.stringMatching(/^people\/ProfileRows\.svelte: value=\{status/)])
  })
})

describe('the value box', () => {
  const base = readFileSync(join(THEMES, 'base.css'), 'utf8')
  const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')

  test('is one column wide, said once', () => {
    expect(tokens).toMatch(/--setting-value:\s*14rem/)
    expect(base).toMatch(
      /\.nib-setting > \.nib-field\.is-value \{[^}]*inline-size:\s*var\(--setting-value\)/,
    )
  })

  test('is the shape the dropdown closes into as well', () => {
    const select = readFileSync(join(LIB, 'Select.svelte'), 'utf8')
    expect(select).toMatch(/class="trigger nib-field is-value"/)
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
    const status = /<span class="nib-field is-value">([\s\S]*?)<\/span>\n/.exec(markup)?.[1]
    expect(status).toMatch(/aria-label=\{t\('Emoji'\)\}/)
    expect(status).toMatch(/aria-label=\{t\('Status'\)\}/)
  })

  test('asks when a status clears only while there is one', () => {
    expect(markup).toMatch(/\{#if status\}\s*<div class="nib-setting setting">[\s\S]*?Clear after/)
  })

  test('changes and removes a picture with the same kind of button', () => {
    const picture = markup.slice(markup.indexOf("t('Picture')"), markup.indexOf("t('Pronouns')"))
    const kinds = new Set([...picture.matchAll(/<button\s+class="([^"]+)"/g)].map((hit) => hit[1]))
    expect([...kinds]).toEqual(['nib-chip'])
  })
})
