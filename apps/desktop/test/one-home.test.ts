import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory())
      return ['node_modules', 'dist', 'test'].includes(entry.name) ? [] : sources(path)
    return /\.(ts|svelte)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

const APP = sources(join(ROOT, 'apps', 'desktop', 'src'))
const EVERYWHERE = [
  ...APP,
  ...readdirSync(join(ROOT, 'packages')).flatMap((one) => {
    try {
      return sources(join(ROOT, 'packages', one, 'src'))
    } catch {
      return []
    }
  }),
]

const holding = (files: readonly string[], pattern: RegExp) =>
  files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file).replace(/\\/g, '/'))

describe('a helper written once', () => {
  test.each([
    [
      'a record check',
      APP,
      /\b(?:function|const) isRecord\b/,
      ['apps/desktop/src/lib/platform/src/stored.ts'],
    ],
    [
      'a day written as YYYY-MM-DD',
      EVERYWHERE,
      /\b(?:two|pad|String)\(\w+\.getMonth\(\) \+ 1\)/,
      ['apps/desktop/src/lib/tasks-model/src/query.ts', 'packages/editor/src/task-days.ts'],
    ],
    [
      'the midnight of a day',
      APP,
      /setHours\(0, 0, 0, 0\)/,
      ['apps/desktop/src/lib/platform/src/region.ts'],
    ],
    [
      'a length on a clock',
      APP,
      /\bwhole % 60\)\.padStart\(2/,
      ['apps/desktop/src/lib/platform/src/region.ts'],
    ],
    [
      'a host as shown',
      EVERYWHERE,
      /new URL\(\w+\)\.host(?:name)?\)?\.replace\(\/\^www/,
      ['packages/scan/src/web-address.ts'],
    ],
    ['a "copied" that goes back', APP, /setTimeout\([^;]*\bcopied\b[^;]*\b1_?600\)/, []],
    [
      'a file name made safe',
      APP,
      /\[<>:"\/\\\\\|\?\*/,
      ['apps/desktop/src/lib/platform/src/web-paths.ts'],
    ],
  ])('%s', (_what, files, pattern, homes) => {
    expect(holding(files, pattern)).toEqual(homes)
  })
})
