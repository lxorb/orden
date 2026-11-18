import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { walk } from './files'

const APP = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(APP, 'src')

const DATA = [
  'unicode-emoji-json/data-by-group.json',
  '@iconify-json/flat-color-icons/icons.json',
  '@iconify-json/simple-icons/icons.json',
  '@iconify-json/fluent-emoji-high-contrast/icons.json',
  '@iconify-json/fluent-emoji-high-contrast/chars.json',
  'virtual:noto-outlines',
  'lucide-static/tags.json',
  'emojilib/emojis.json',
]

const files = walk(SOURCE, (path) => /\.(ts|svelte)$/.test(path) && !path.endsWith('.d.ts')).map(
  (path) => ({
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    text: readFileSync(path, 'utf8'),
  }),
)

describe('the icon sets that are data rather than drawing', () => {
  test('are asked for, so somewhere in the app knows their names', () => {
    for (const one of DATA) {
      expect(
        files.some((file) => file.text.includes(one)),
        one,
      ).toBe(true)
    }
  })

  test('are only ever reached through a dynamic import', () => {
    const offenders: string[] = []

    for (const file of files) {
      for (const one of DATA) {
        if (!file.text.includes(one)) continue

        for (const match of file.text.matchAll(new RegExp(`.{0,10}['"]${escaped(one)}['"]`, 'g'))) {
          if (!match[0].includes('import(')) offenders.push(`${file.name}: ${match[0].trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  test('and one module asks for them', () => {
    for (const one of DATA) {
      expect(
        files.filter((file) => file.text.includes(one)).map((file) => file.name),
        one,
      ).toEqual(['/lib/icons/src/icon-sets.ts'])
    }
  })

  test('and the plugin build leaves every one of them out', () => {
    const config = readFileSync(join(APP, 'vite.even.config.ts'), 'utf8')
    const left = config.slice(config.indexOf('const LEFT_OUT'), config.indexOf('/** What a module'))

    for (const one of DATA) expect(left, one).toContain(one)
  })
})

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
