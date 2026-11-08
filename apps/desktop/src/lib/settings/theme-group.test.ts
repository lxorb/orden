import { readFileSync } from 'node:fs'
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
const { t } = await import('../i18n.svelte')

const LIB = join(import.meta.dirname, '..')
const PANEL = readFileSync(join(LIB, 'SettingsPanel.svelte'), 'utf8')
const IMPORT = readFileSync(join(LIB, 'settings/BrowserThemes.svelte'), 'utf8')

const snippet = (name: string) => {
  const start = PANEL.indexOf(`{#snippet ${name}()}`)
  return start < 0 ? '' : PANEL.slice(start, PANEL.indexOf('{/snippet}', start))
}

const named = (source: string) =>
  [...source.matchAll(/<span class="name">\{t\('([^']+)'\)\}<\/span>|<(BrowserThemes) \/>/g)].map(
    (hit) => hit[1] ?? hit[2],
  )

describe('the Theme group in Appearance', () => {
  test('starts with Style and Mode', () => {
    const [theme] = appearancePane().groups
    expect(theme?.title).toBe(t('Theme'))
    expect(theme?.fields.slice(0, 2).map((one) => one.key)).toEqual([
      'appearance.style',
      'appearance.mode',
    ])
  })

  test('holds Browse themes, Reload and Import right below Mode', () => {
    expect(PANEL).toMatch(
      /\{@render row\(field\)\}\s*\{#if field\.key === 'appearance\.mode'\}\{@render themeTools\(\)\}\{\/if\}/,
    )
    expect(named(snippet('themeTools'))).toEqual([
      'Themes',
      'Reload themes and custom CSS',
      'BrowserThemes',
    ])
    expect(IMPORT).toContain(`<span class="name">{t('Import')}</span>`)
  })

  test('leaves no group of its own for themes, custom CSS or import', () => {
    const titles = appearancePane().groups.map((one) => one.title)
    for (const gone of ['Themes', 'Custom', 'Import']) expect(titles).not.toContain(t(gone))
    expect(snippet('appearanceExtras')).toBe('')
    expect(PANEL).not.toContain(`<h3>{t('Custom')}</h3>`)
  })

  test('is found by Settings search, and each link lands on a row that carries its name', () => {
    const rows = [...named(snippet('themeTools')), 'Import']
    const linked = places()
      .filter((one) => one.section === 'appearance')
      .map((one) => one.label)
    expect(linked).toEqual(
      expect.arrayContaining(['Themes', 'Reload themes and custom CSS', 'Import']),
    )
    for (const label of linked) expect(rows).toContain(label)
  })
})
