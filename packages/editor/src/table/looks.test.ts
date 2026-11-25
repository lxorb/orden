import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../../../themes/src/${name}`, import.meta.url), 'utf8')
function declared(css: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [, selectors = '', body = ''] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((one) => one.trim() === selector)) continue
    for (const [, name = '', value = ''] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) found[name] = value.trim()
  }
  return found
}
const editing = read('editor.css')
const reading = read('base.css')
describe('one table looks the same while it is edited and while it is read', () => {
  const cell = declared(editing, '#write .orden-table td')
  const read = { ...declared(reading, '#write td'), ...declared(reading, '#write .reading-table td') }
  test.each(['padding', 'min-width', 'vertical-align', 'border', 'text-align'])('a cell’s %s', (property) => {
    expect(cell[property]).toBeDefined()
    expect(read[property]).toBe(cell[property])
  })
  test('the size of its text', () => {
    expect(declared(reading, '#write table')['font-size']).toBe(declared(editing, '#write .orden-table')['font-size'])
  })
  test('how narrow it may get', () => {
    const drawn = declared(editing, '#write .orden-table')
    const shown = declared(reading, '#write .reading-table > table')
    expect(shown['min-width']).toBe(drawn['min-width'])
    expect(shown.width).toBe(drawn.width)
  })
  test.each(['background', 'font-weight', 'color', 'border-bottom-color'])('a header’s %s', (property) => {
    expect(declared(reading, '#write th')[property]).toBe(declared(editing, '#write .orden-table th')[property])
  })
})
