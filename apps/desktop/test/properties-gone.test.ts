import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const APP = join(ROOT, 'apps/desktop/src')
const EDITOR = join(ROOT, 'packages/editor/src')
const THEMES = join(ROOT, 'packages/themes/src')

function files(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, keep))
    else if (keep(path)) out.push(path)
  }
  return out
}

const read = (path: string) => readFileSync(path, 'utf8')

const source = (dir: string) =>
  files(
    dir,
    (path) =>
      /\.(ts|svelte)$/.test(path) && !path.endsWith('.test.ts') && !/[\\/]locales[\\/]/.test(path),
  )

const OFFERS =
  /'show-properties'|'add-property'|'app\.properties'|`properties:\$\{|'paragraph\.front-matter'|'markdown\.frontMatter'|setProperties|showProperties|newProperty|PropertiesWidget|propertyChoices|hiddenFrontMatter/

describe("a note's properties (#1210)", () => {
  test('no command, menu row, palette row, shortcut or setting of the app reaches them', () => {
    expect(source(APP).filter((path) => OFFERS.test(read(path)))).toEqual([])
  })

  test('the editor draws no properties block and hides no front matter', () => {
    expect(source(EDITOR).filter((path) => OFFERS.test(read(path)))).toEqual([])
    const sheets = files(THEMES, (path) => path.endsWith('.css'))
    expect(sheets.filter((path) => read(path).includes('.orden-propert'))).toEqual([])
  })
})
