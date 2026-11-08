import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))
const SHEET = fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url))

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

test('a bar filled to a share still shows its fill in forced colours', () => {
  const sheet = readFileSync(SHEET, 'utf8')
  const forced = sheet.slice(sheet.indexOf('@media (forced-colors: active)'))
  expect(forced).toMatch(/\.orden-meter-fill\s*\{\s*background:\s*Highlight;/)

  const blank = svelteFiles(SOURCE).flatMap((path) => {
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
