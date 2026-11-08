import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { TAB_KINDS } from '../src/lib/workspace/tab-kinds'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

const app = read('App.svelte')
const plus =
  /\{#if viewport\.touch[^}]*!ownBar\(workspace\.active\?\.kind\)[^}]*\}\s*<button class="fab"/

function roomUnderThePlus(style: string, scroller: string): boolean {
  for (const rule of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [selectors, body] = [rule[1] ?? '', rule[2] ?? '']
    if (!selectors.includes('main:has(.fab)')) continue
    if (!selectors.split(',').some((one) => one.trim().endsWith(scroller))) continue
    if (/padding-bottom:[^;]*var\(--touch-row\)/.test(body)) return true
  }
  return false
}

describe('the phone’s + button over Settings', () => {
  test('is drawn over a Settings tab', () => {
    expect(app).toMatch(plus)
    expect(TAB_KINDS.settings.ownBar).toBe(false)
  })

  test.each(['nav', '.body'])(
    'leaves the end of the list and of a page, %s, scrollable out from under it',
    (scroller) => {
      expect(roomUnderThePlus(read('lib/SettingsPanel.svelte'), `.sheet.phone ${scroller}`)).toBe(
        true,
      )
    },
  )
})
