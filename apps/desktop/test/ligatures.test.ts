import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ROOT, SOURCE, walk } from './files'

const THEMES = join(ROOT, 'packages/themes/src')
const BASE = readFileSync(join(THEMES, 'base.css'), 'utf8')
const SHEETS = [
  ...walk(THEMES, (path) => path.endsWith('.css')),
  ...walk(SOURCE, (path) => /\.(css|svelte)$/.test(path), ['node_modules']),
  ...walk(join(ROOT, 'apps/desktop'), (path) => path.endsWith('.html'), [
    'node_modules',
    'src',
    'dist',
    'src-tauri',
    'test',
  ]),
]
const CODE = walk(SOURCE, (path) => /\.(ts|svelte)$/.test(path) && !path.includes('.test.'), ['node_modules'])
const FEATURES = ['liga', 'calt', 'dlig', 'hlig', 'clig']
function turnsOn(property: string, value: string): boolean {
  const said = value
    .replace(/!important/g, '')
    .trim()
    .toLowerCase()
  if (property === 'font-variant-ligatures') return said !== 'none'
  if (property === 'font-variant') return /(common|discretionary|historical)-ligatures|\bcontextual\b/.test(said)
  if (property !== 'font-feature-settings') return false
  return said.split(',').some((one) => {
    const [tag, ...rest] = one.trim().split(/\s+/)
    const name = (tag ?? '').replace(/["']/g, '')
    const setting = rest.join(' ')
    return FEATURES.includes(name) && setting !== '0' && setting !== 'off'
  })
}
function declarations(text: string): { property: string; value: string }[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/(font-variant-ligatures|font-feature-settings|font-variant)\s*:\s*([^;}]+)/g)].map(
    (one) => ({
      property: one[1] ?? '',
      value: one[2] ?? '',
    }),
  )
}
describe('ligatures', () => {
  test('are turned off for every element and its pseudo-elements by one rule nothing can override', () => {
    const rule = /\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/.exec(BASE)?.[1] ?? ''
    expect(rule).toMatch(/font-variant-ligatures:\s*none\s*!important/)
    const settings = /font-feature-settings:([^;]*)/.exec(rule)?.[1] ?? ''
    expect(settings).toContain('!important')
    for (const feature of ['liga', 'calt', 'dlig']) expect(settings).toMatch(new RegExp(`'${feature}'\\s+0`))
  })
  test('are told apart wherever a stylesheet would turn them on', () => {
    expect(turnsOn('font-variant-ligatures', 'normal')).toBe(true)
    expect(turnsOn('font-variant-ligatures', 'common-ligatures')).toBe(true)
    expect(turnsOn('font-variant-ligatures', 'none !important')).toBe(false)
    expect(turnsOn('font-feature-settings', "'liga'")).toBe(true)
    expect(turnsOn('font-feature-settings', '"calt" 1')).toBe(true)
    expect(turnsOn('font-feature-settings', "'liga' 0, 'calt' 0, 'dlig' 0")).toBe(false)
    expect(turnsOn('font-feature-settings', "'tnum'")).toBe(false)
    expect(turnsOn('font-variant', 'small-caps common-ligatures')).toBe(true)
    expect(turnsOn('font-variant', 'small-caps')).toBe(false)
  })
  test('are never turned back on by a stylesheet of the app, its themes or its pages', () => {
    const on = SHEETS.flatMap((path) =>
      declarations(readFileSync(path, 'utf8'))
        .filter((one) => turnsOn(one.property, one.value))
        .map((one) => `${relative(ROOT, path).replace(/\\/g, '/')}: ${one.property}: ${one.value.trim()}`),
    )
    expect(on).toEqual([])
  })
  test('are never turned back on from code', () => {
    const on = CODE.filter((path) =>
      /fontVariantLigatures|fontFeatureSettings|font-variant-ligatures|font-feature-settings/.test(
        readFileSync(path, 'utf8'),
      ),
    )
      .filter(
        (path) =>
          !path.endsWith('.svelte') ||
          /(fontVariantLigatures|fontFeatureSettings|style:font-variant-ligatures|style:font-feature-settings)/.test(
            readFileSync(path, 'utf8'),
          ),
      )
      .map((path) => relative(ROOT, path).replace(/\\/g, '/'))
    expect(on).toEqual([])
  })
})
