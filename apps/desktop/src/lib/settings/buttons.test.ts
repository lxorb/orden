import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const LIB = fileURLToPath(new URL('..', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

const PANES = svelteFiles(LIB)
  .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
  .filter((one) => one.source.includes('orden-setting') && !one.path.startsWith('views/'))

const SHARED =
  /\b(orden-chip|orden-button|orden-action|orden-glyph|orden-tag|orden-row|orden-setting)\b/

const OWN: Record<string, RegExp> = {
  'Swatches.svelte': /class="swatch/,
  'SettingsPanel.svelte': /class="(thumb|key|link)"/,
  '*': /role="(radio|tab)"/,
  'settings/ExtensionRows.svelte': /class="name"/,
  'remote/RemotePane.svelte': /class="(open|link)"/,
  'pass/SettingsImport.svelte': /class="source"/,
}

function buttons(source: string): string[] {
  return [...source.matchAll(/<button\b([^>]*?)>/g)].map((hit) =>
    (hit[1] ?? '').replace(/\s+/g, ' '),
  )
}

describe('a button in Settings', () => {
  test('is read in the panes that draw rows', () => {
    expect(PANES.map((one) => one.path)).toEqual(
      expect.arrayContaining(['SettingsPanel.svelte', 'MigrateRows.svelte', 'AiPane.svelte']),
    )
  })

  test("is one of the app's own", () => {
    const own = PANES.flatMap(({ path, source }) =>
      buttons(source)
        .filter((tag) => !SHARED.test(tag))
        .filter((tag) => !OWN['*']?.test(tag) && !OWN[path]?.test(tag))
        .map((tag) => `${path}: ${tag.trim().slice(0, 60)}`),
    )
    expect(own).toEqual([])
  })

  test('at the end of a row is never a dialog’s soft button', () => {
    const soft = PANES.filter(({ source }) => source.includes('orden-button is-quiet is-soft'))
    expect(soft.map((one) => one.path)).toEqual([])
  })
})

describe('a row in Settings', () => {
  test('keeps its explanation behind its ?, never as a line of text under its name', () => {
    const inline = PANES.flatMap(({ path, source }) =>
      [...source.matchAll(/<(small|p)\b[^>]*>\s*\{[^}]*\b(why|hint)\b[^}]*\}/g)].map(
        (hit) => `${path}: ${hit[0]}`,
      ),
    )
    expect(inline).toEqual([])
  })
})

const SETTINGS =
  /^((SettingsPanel|AiPane|SyncPane|Security|MigrateRows|RecentlyDeleted)\.svelte|people\/ProfileRows\.svelte|(settings|access|agents\/settings|online|remote)\/.+)$/

describe('an on/off control in Settings', () => {
  test('is the shared switch, never one drawn by hand', () => {
    const files = svelteFiles(LIB)
      .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
      .filter((one) => SETTINGS.test(one.path))
    expect(files.map((one) => one.path)).toEqual(
      expect.arrayContaining(['SettingsPanel.svelte', 'settings/ExtensionRows.svelte']),
    )
    const own = files
      .filter(({ source }) => /orden-switch|role="switch"/.test(source))
      .map((one) => one.path)
    expect(own).toEqual([])
  })
})

describe('Settings > Import', () => {
  const source = readFileSync(join(LIB, 'MigrateRows.svelte'), 'utf8')
  const markup = source.slice(source.indexOf('</script>'), source.indexOf('{#snippet mark'))
  const rows = markup.split('<div class="orden-setting">').slice(1)

  test('answers every source with the row’s button', () => {
    for (const row of rows) {
      for (const tag of buttons(row)) expect(tag).toMatch(/class="orden-chip( is-quiet)?"/)
    }
  })

  test('says it is at work while an import runs', () => {
    for (const row of rows) {
      for (const tag of buttons(row)) expect(tag).toMatch(/aria-busy=/)
    }
  })

  test('puts its mark in front of every source it names', () => {
    const named = rows.filter((row) => !row.includes('<span class="name"></span>'))
    expect(named.length).toBeGreaterThan(8)
    for (const row of named) expect(row.trimStart()).toMatch(/^\{@render mark\(/)
  })
})
