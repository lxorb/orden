import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
}))

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const { appearancePane } = await import('./appearance-pane')
const { places } = await import('./places')

const LIB = join(import.meta.dirname, '..')
const PANEL = readFileSync(join(LIB, 'SettingsPanel.svelte'), 'utf8')
const TAURI = join(LIB, '../../src-tauri/src')

const snippet = (name: string) => {
  const start = PANEL.indexOf(`{#snippet ${name}()}`)
  return start < 0 ? '' : PANEL.slice(start, PANEL.indexOf('{/snippet}', start))
}

const named = (source: string) =>
  [...source.matchAll(/<span class="name">([^<{]+)<\/span>/g)].map((hit) => hit[1])

function* sources(folder: string): Generator<string> {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.(ts|svelte|rs)$/.test(entry.name)) yield path
  }
}

describe('the Theme group in Appearance', () => {
  test('starts with Style and Mode', () => {
    const [theme] = appearancePane().groups
    expect(theme?.title).toBe('Theme')
    expect(theme?.fields.slice(0, 2).map((one) => one.key)).toEqual([
      'appearance.style',
      'appearance.mode',
    ])
  })

  test('holds Browse themes and Reload right below Mode', () => {
    expect(PANEL).toMatch(
      /\{@render row\(field\)\}\s*\{#if field\.key === 'appearance\.mode'\}\{@render themeTools\(\)\}\{\/if\}/,
    )
    expect(named(snippet('themeTools'))).toEqual(['Themes', 'Reload themes and custom CSS'])
  })

  test('leaves no group of its own for themes, custom CSS or import', () => {
    const titles = appearancePane().groups.map((one) => one.title)
    for (const gone of ['Themes', 'Custom', 'Import']) expect(titles).not.toContain(gone)
    expect(snippet('appearanceExtras')).toBe('')
    expect(PANEL).not.toContain('<h3>Custom</h3>')
  })

  test('is found by Settings search, and each link lands on a row that carries its name', () => {
    const rows = named(snippet('themeTools'))
    const linked = places()
      .filter((one) => one.section === 'appearance')
      .map((one) => one.label)
    expect(linked).toEqual(expect.arrayContaining(['Themes', 'Reload themes and custom CSS']))
    for (const label of linked) expect(rows).toContain(label)
  })

  test('imports no theme from Chrome or Firefox, in the app or its crate', () => {
    expect(existsSync(join(LIB, 'settings/BrowserThemes.svelte'))).toBe(false)
    expect(existsSync(join(LIB, 'themes/browser.ts'))).toBe(false)
    expect(existsSync(join(TAURI, 'browser_themes.rs'))).toBe(false)
    expect(places().filter((one) => one.label === 'Import')).toEqual([])
    const gone = /browser_themes|BrowserTheme|wearFirefoxTheme|userChrome|statictheme.*Theme/
    for (const path of [...sources(LIB), ...sources(TAURI)]) {
      if (path === import.meta.filename) continue
      expect(readFileSync(path, 'utf8'), path).not.toMatch(gone)
    }
  })
})
