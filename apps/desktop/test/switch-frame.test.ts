import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const APP = readFileSync(join(import.meta.dirname, '../src/App.svelte'), 'utf8')
const SETTINGS = join(import.meta.dirname, '../src/lib/settings/src')
const SHEETS = [
  ['App.svelte', APP],
  ...readdirSync(SETTINGS)
    .filter((name) => name.endsWith('.svelte'))
    .map((name) => [name, readFileSync(join(SETTINGS, name), 'utf8')]),
]
function calls(text: string, name: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
    let depth = 1
    let at = match.index + match[0].length
    while (depth > 0 && at < text.length) {
      if (text[at] === '(') depth++
      if (text[at] === ')') depth--
      at++
    }
    found.push(text.slice(match.index, at))
  }
  return found
}
describe('the frame a tab switch draws', () => {
  test('gives the caret to the editor only after it is painted, so its focus forces no layout into that frame', () => {
    const frames = calls(APP, 'requestAnimationFrame')
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      const own = calls(frame, 'setTimeout').reduce((left, later) => left.replace(later, ''), frame)
      expect(own).not.toMatch(/\.focus\(\)/)
    }
  })
  test('takes a key pressed before the caret came, and gives the caret only after the frame is painted', () => {
    expect(APP).toMatch(/stop = one\.caretAfterPaint\(\(\) => \{/)
  })
  test('leaves the caret where it is when the editor has it already', () => {
    expect(APP).toMatch(/!current\.hasFocus\) current\.focus\(\)/)
  })
  test.each(SHEETS)(
    '%s asks no :has() of the whole app, which would have every switch restyle it from the top',
    (_, sheet) => {
      expect(sheet).not.toMatch(/(^|[\s,}(])(main|html|body)(\.[\w-]+|\[[^\]]*\])*\)?:has\(/m)
    },
  )
})
