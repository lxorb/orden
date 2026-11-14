import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const PLACES = ['apps/desktop/src', 'apps/desktop/test', 'apps/cli', 'packages', 'services/sync']

const PASSED = new Set(['node_modules', 'dist', 'target', 'coverage', '.svelte-kit'])

const CODE = /\.(ts|svelte|js|mjs)$/

const CATALOGUE_FOLDER = /^(locales?|i18n|l10n|translations?|lang)$/i

const CATALOGUE_FILE = /(^|[.-])(i18n|l10n|locales?|translations?)([.-]|$)/i

const CATALOGUE_IMPORT =
  /from\s+['"][^'"]*(^|\/)(i18n|l10n|locales?|translations?)(\.svelte)?(\.[jt]s)?(\/[^'"]*)?['"]/

const TRANSLATED = /(?<![\w.$])(t|plural)\(\s*['"`]/

const OWN = fileURLToPath(import.meta.url)

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    if (PASSED.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

const files = PLACES.flatMap((place) => walk(join(ROOT, place)))
const code = files.filter((path) => CODE.test(path) && path !== OWN)
const shown = (path: string) => relative(ROOT, path).replace(/\\/g, '/')

function folders(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    if (PASSED.has(name)) continue
    const path = join(dir, name)
    if (!statSync(path).isDirectory()) continue
    found.push(path)
    folders(path, found)
  }
  return found
}

describe('Orden speaks English only', () => {
  test('the walk reaches the app, its packages and the server', () => {
    expect(code.some((path) => shown(path).startsWith('apps/desktop/src/lib/'))).toBe(true)
    expect(code.some((path) => shown(path).startsWith('packages/editor/src/'))).toBe(true)
    expect(code.some((path) => shown(path).startsWith('services/sync/src/'))).toBe(true)
  })

  test('with no folder of catalogues anywhere', () => {
    const found = PLACES.flatMap((place) => folders(join(ROOT, place)))
      .filter((path) => CATALOGUE_FOLDER.test(path.split(/[\\/]/).at(-1) ?? ''))
      .map(shown)
    expect(found).toEqual([])
  })

  test('nor a catalogue or translation module by any name', () => {
    const found = code
      .filter((path) => CATALOGUE_FILE.test(path.split(/[\\/]/).at(-1) ?? ''))
      .map(shown)
    expect(found).toEqual([])
  })

  test('and nothing that imports one', () => {
    const found = code
      .filter((path) => CATALOGUE_IMPORT.test(readFileSync(path, 'utf8')))
      .map(shown)
    expect(found).toEqual([])
  })

  test('and no words handed to a translation call', () => {
    const found = code.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, at) => (TRANSLATED.test(line) ? [`${shown(path)}:${at + 1}`] : [])),
    )
    expect(found).toEqual([])
  })

  test('nor a phone resource in another language', () => {
    const resources = join(ROOT, 'apps/desktop/src-tauri/gen/android/app/src/main/res')
    const other = readdirSync(resources).filter(
      (name) => /^values-[a-z]{2,3}(-|$)/.test(name) && !/^values-(night|v\d+)/.test(name),
    )
    expect(other).toEqual([])
  })

  test('nor a language to choose in the settings', () => {
    const general = readFileSync(
      join(ROOT, 'apps/desktop/src/lib/settings/src/general-pane.ts'),
      'utf8',
    )
    expect(general).not.toContain("'general.language'")
  })

  test('nor a page turned right to left for the language it is in', () => {
    const found = code
      .filter((path) => /documentElement\.(dir|lang)\s*=/.test(readFileSync(path, 'utf8')))
      .map(shown)
    expect(found).toEqual([])
  })
})
