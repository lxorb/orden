import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('../..', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../../../../packages/themes/src/', import.meta.url))
function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}
const FILES = svelteFiles(LIB).map((path) => ({
  path: path.slice(LIB.length),
  source: readFileSync(path, 'utf8'),
}))
const PANES = FILES.filter((one) => one.source.includes('orden-setting'))
const ROWS = PANES.filter((one) => !one.path.startsWith('views/'))
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
        'settings/src/SettingsPanel.svelte',
        'accounts-ui/src/ProfileRows.svelte',
        'accounts-ui/src/Security.svelte',
        'settings/src/SyncPane.svelte',
        'ai-sidebar/src/AiPane.svelte',
      ]),
    )
  })
  test('draws no field of its own', () => {
    const own = PANES.filter(({ source }) => /class="[^"]*\binline\b|\.inline\b/.test(source))
    expect(own.map((one) => one.path)).toEqual([])
  })
  test('puts its value in the one column, not at a width of its own', () => {
    const widths = PANES.flatMap(({ path, source }) =>
      [...styleOf(source).matchAll(/(?<![-\w])(min-)?width:\s*1[24]rem/g)].map((hit) => `${path}: ${hit[0]}`),
    )
    expect(widths).toEqual(['settings/src/SettingsPanel.svelte: min-width: 12rem'])
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
    expect(bare).toEqual([expect.stringMatching(/^accounts-ui\/src\/ProfileRows\.svelte: value=\{status/)])
  })
})
describe('the value box', () => {
  const base = readFileSync(join(THEMES, 'base.css'), 'utf8')
  const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')
  test('is one column wide, said once', () => {
    expect(tokens).toMatch(/--setting-value:\s*14rem/)
    expect(base).toMatch(/\.orden-setting > \.orden-field\.is-value \{[^}]*inline-size:\s*var\(--setting-value\)/)
  })
  test('is the shape the dropdown closes into as well', () => {
    const select = readFileSync(join(LIB, 'ui-controls', 'src', 'Select.svelte'), 'utf8')
    expect(select).toMatch(/class="trigger orden-field is-value"/)
    expect(styleOf(select)).not.toMatch(/\n {2}\.trigger \{[^}]*border:/)
  })
})
describe('Settings > Account', () => {
  const rows = readFileSync(join(LIB, 'accounts-ui/src/ProfileRows.svelte'), 'utf8')
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
    expect(markup).toMatch(/\{#if status\}\s*<div class="orden-setting setting">[\s\S]*?Clear after/)
  })
  test('changes and removes a picture with the same kind of button', () => {
    const picture = markup.slice(markup.indexOf('>Picture<'), markup.indexOf('>Pronouns<'))
    const kinds = new Set([...picture.matchAll(/<button\s+class="([^"]+)"/g)].map((hit) => hit[1]))
    expect([...kinds]).toEqual(['orden-chip'])
  })
})
const SHARED = /\b(orden-chip|orden-button|orden-action|orden-glyph|orden-tag|orden-row|orden-setting)\b/
const OWN: Record<string, RegExp> = {
  'ui-controls/src/Swatches.svelte': /class="swatch/,
  'settings/src/SettingsPanel.svelte': /class="(thumb|key|link)"/,
  '*': /role="(radio|tab)"/,
  'web-tab/src/ExtensionRows.svelte': /class="name"/,
  'terminal/src/remote/RemotePane.svelte': /class="(open|link)"/,
  'pass-ui/src/SettingsImport.svelte': /class="source"/,
}
function buttons(source: string): string[] {
  return [...source.matchAll(/<button\b([^>]*?)>/g)].map((hit) => (hit[1] ?? '').replace(/\s+/g, ' '))
}
describe('a button in Settings', () => {
  test('is read in the panes that draw rows', () => {
    expect(ROWS.map((one) => one.path)).toEqual(
      expect.arrayContaining([
        'settings/src/SettingsPanel.svelte',
        'import/src/MigrateRows.svelte',
        'ai-sidebar/src/AiPane.svelte',
      ]),
    )
  })
  test("is one of the app's own", () => {
    const own = ROWS.flatMap(({ path, source }) =>
      buttons(source)
        .filter((tag) => !SHARED.test(tag))
        .filter((tag) => !OWN['*']?.test(tag) && !OWN[path]?.test(tag))
        .map((tag) => `${path}: ${tag.trim().slice(0, 60)}`),
    )
    expect(own).toEqual([])
  })
  test('at the end of a row is never a dialog’s soft button', () => {
    const soft = ROWS.filter(({ source }) => source.includes('orden-button is-quiet is-soft'))
    expect(soft.map((one) => one.path)).toEqual([])
  })
})
describe('a row in Settings', () => {
  test('keeps its explanation behind its ?, never as a line of text under its name', () => {
    const inline = ROWS.flatMap(({ path, source }) =>
      [...source.matchAll(/<(small|p)\b[^>]*>\s*\{[^}]*\b(why|hint)\b[^}]*\}/g)].map((hit) => `${path}: ${hit[0]}`),
    )
    expect(inline).toEqual([])
  })
})
const SETTINGS =
  /^((SettingsPanel|SyncPane|Security|RecentlyDeleted)\.svelte|(people\/ProfileRows|import\/src\/MigrateRows|web-tab\/src\/ExtensionRows|ai-sidebar\/src\/AiPane)\.svelte|(settings|access|agents\/settings|online|remote)\/.+)$/
describe('an on/off control in Settings', () => {
  test('is the shared switch, never one drawn by hand', () => {
    const files = FILES.filter((one) => SETTINGS.test(one.path))
    expect(files.map((one) => one.path)).toEqual(
      expect.arrayContaining(['settings/src/SettingsPanel.svelte', 'web-tab/src/ExtensionRows.svelte']),
    )
    const own = files.filter(({ source }) => /orden-switch|role="switch"/.test(source)).map((one) => one.path)
    expect(own).toEqual([])
  })
})
describe('Settings > Import', () => {
  const source = readFileSync(join(LIB, 'import/src/MigrateRows.svelte'), 'utf8')
  const markup = source.slice(source.indexOf('</script>'), source.indexOf('{#snippet mark'))
  const rows = markup.split('<div class="orden-setting">').slice(1)
  test('answers every source with the row’s button, which says it is at work while an import runs', () => {
    for (const tag of rows.flatMap(buttons)) {
      expect(tag).toMatch(/class="orden-chip( is-quiet)?"/)
      expect(tag).toMatch(/aria-busy=/)
    }
  })
  test('puts its mark in front of every source it names', () => {
    const named = rows.filter((row) => !row.includes('<span class="name"></span>'))
    expect(named.length).toBeGreaterThan(8)
    for (const row of named) expect(row.trimStart()).toMatch(/^\{@render mark\(/)
  })
})
