import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Every button in Settings is one of the app's own (#1057).
 *
 *  Settings > Import answered each source with a dialog's button - `.nib-button
 *  is-quiet is-soft`, heavy type on a fill of its own that did not change under the
 *  pointer - where every other row answers with `.nib-chip`. And four more panes
 *  had drawn their own 26px square for a mark that is pressed (reset a shortcut,
 *  move a host, take a rule away, go back), three their own removable word, and the
 *  shortcut clash its own pair of buttons. Each is a shape in the themes package
 *  now; these read every component that draws a setting's row and refuse a button
 *  that is not one of them unless it is named below with its reason.
 *
 *  Read out of the sources rather than measured, for the reason Editor.test.ts gives. */

const LIB = fileURLToPath(new URL('..', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

/** Every component that draws a setting's row, outside the views' own settings. */
const PANES = svelteFiles(LIB)
  .map((path) => ({ path: path.slice(LIB.length), source: readFileSync(path, 'utf8') }))
  .filter((one) => one.source.includes('nib-setting') && !one.path.startsWith('views/'))

/** The app's own buttons, in the themes package. */
const SHARED = /\b(nib-chip|nib-button|nib-action|nib-glyph|nib-tag|nib-row|nib-setting)\b/

/** Buttons that are not a button of the app's kind, each for a reason of its own. */
const OWN: Record<string, RegExp> = {
  // A colour, which is the whole of what it shows.
  'Swatches.svelte': /class="swatch/,
  // A wallpaper, shown as itself; the key being recorded; a link inside a sentence.
  'SettingsPanel.svelte': /class="(thumb|key|link)"/,
  // A half of a segmented control, drawn by `.nib-segmented`.
  '*': /role="(radio|tab)"/,
  // A row that opens itself, and the switch at its end.
  'settings/ExtensionRows.svelte': /class="(name|toggle)"/,
  // A host's row that opens it; a link to the config.
  'remote/RemotePane.svelte': /class="(open|link)"/,
  // A theme, shown as a little window of itself.
  'settings/BrowserThemes.svelte': /class="card"/,
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
    const soft = PANES.filter(({ source }) => source.includes('nib-button is-quiet is-soft'))
    expect(soft.map((one) => one.path)).toEqual([])
  })
})

describe('Settings > Import', () => {
  const source = readFileSync(join(LIB, 'MigrateRows.svelte'), 'utf8')
  const markup = source.slice(source.indexOf('</script>'), source.indexOf('{#snippet mark'))
  const rows = markup.split('<div class="nib-setting">').slice(1)

  test('answers every source with the row’s button', () => {
    for (const row of rows) {
      for (const tag of buttons(row)) expect(tag).toMatch(/class="nib-chip( is-quiet)?"/)
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
