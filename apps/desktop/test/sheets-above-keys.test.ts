import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { expect, test } from 'vitest'
import { SOURCE, svelte, walk } from './files'

const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/
const RULE = /([^{}]+)\{([^{}]*)\}/g
const BOTTOM = /(?:^|[\s;])bottom:\s*([^;]+);/
const ON_A_PHONE = /\[data-touch\]|\[data-drawer\]|\[data-device='phone'\]|\.sheet\b/
const IN_THE_FLOW = /position:\s*(absolute|relative|sticky)/
const TYPED_IN =
  /<textarea\b|contenteditable|\{@render\b|<input\b(?![^>]*type="(?:checkbox|radio|range|color|file|hidden)")/

interface Pinned {
  path: string
  selector: string
  bottom: string
}
function pinned(): Pinned[] {
  return walk(SOURCE, svelte).flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    const style = STYLE.exec(text)
    if (!style || !TYPED_IN.test(text.slice(0, style.index))) return []
    return [...(style[1] ?? '').matchAll(RULE)].flatMap(([, selector = '', body = '']) => {
      const bottom = BOTTOM.exec(body)?.[1]
      if (!bottom || !ON_A_PHONE.test(selector) || IN_THE_FLOW.test(body)) return []
      return [{ path: relative(SOURCE, path), selector: selector.trim().replace(/\s+/g, ' '), bottom }]
    })
  })
}
test('the scan finds the sheets it is meant to hold', () => {
  const found = pinned().map((one) => one.path)
  expect(found).toContain('lib/accounts-ui/src/SignIn.svelte')
  expect(found).toContain('lib/ui-controls/src/Sheet.svelte')
  expect(found).toContain('lib/surfaces/src/PromptSheet.svelte')
  expect(found).toContain('lib/chat-kit/src/Float.svelte')
  expect(found.length).toBeGreaterThan(10)
})
test('a sheet with a field in it, pinned to the bottom of a phone, sits on the keyboard and not under it', () => {
  const under = pinned().filter((one) => !one.bottom.includes('--keyboard'))
  expect(under).toEqual([])
})
