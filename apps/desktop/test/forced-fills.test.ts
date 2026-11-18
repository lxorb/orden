import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { svelte, walk } from './files'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))
const SHEET = fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url))

test('a bar filled to a share still shows its fill in forced colours', () => {
  const sheet = readFileSync(SHEET, 'utf8')
  const forced = sheet.slice(sheet.indexOf('@media (forced-colors: active)'))
  expect(forced).toMatch(/\.orden-meter-fill\s*\{\s*background:\s*Highlight;/)

  const blank = walk(SOURCE, svelte).flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    const fills = [...text.matchAll(/<\w+\b([^>]*style:width="\{[^"]*\* 100\}%"[^>]*)>/g)]
      .map((one) => one[1] ?? '')
      .filter((one) => !one.includes('closeUp') && !one.includes('orden-meter-fill'))
    if (!fills.length) return []
    const drawn = /@media \(forced-colors: active\)[\s\S]*?(?:Highlight|CanvasText)/.test(text)
    const painted = fills.some((one) => one.includes('style:background='))
    return drawn && !painted ? [] : [path.slice(SOURCE.length)]
  })
  expect(blank).toEqual([])
})
