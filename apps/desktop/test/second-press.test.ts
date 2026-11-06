import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
    }
  }
  walk(SOURCE)
  return out
}

const NOT_LAYERS: Record<string, string> = {
  'lib/spent-click.ts': 'spends the click a catch took the press of',
  'lib/tab-cycle.svelte.ts': 'a press ends Ctrl+Tab, which has no button',
  'lib/tab-strip/hover-card.svelte.ts': 'a press hushes a card shown by hovering',
  'lib/RenameNotice.svelte': 'a notice nothing opened, gone at the first press or key',
  'lib/web-tab/WebTab.svelte': 'a press hides the native page before what it opens is drawn',
  'lib/web-tab/AddressField.svelte': 'a press says where the keyboard goes once it is over',
  'lib/downloads/started.ts': 'a press says where a download was asked for, to fly from',
  'lib/select-all.ts': 'a press inside a name field leaves its second take of the words alone',
  'lib/views/pressed-away.ts': 'a press past the rows selected lets them go, no layer up',
}

const NOT_YET = new Set(['lib/web-tab/WebExtensionPopup.svelte'])

const PRESS = /(?:window|document)\.addEventListener\(\s*'(?:pointerdown|mousedown|touchstart)'/

describe('a layer closed by a press past it', () => {
  test('is on the stack overlays.ts keeps, and does not listen to the window itself', () => {
    const wrong = sources()
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
      .filter((name) => !(name in NOT_LAYERS) && !NOT_YET.has(name))
      .filter((name) => !name.startsWith('lib/back-swipe/'))
      .filter((name) => PRESS.test(readFileSync(join(SOURCE, name), 'utf8')))

    expect(wrong).toEqual([])
  })

  test('and the stack reads every press and every click before anything under it', () => {
    const app = readFileSync(join(SOURCE, 'App.svelte'), 'utf8')
    expect(app).toMatch(/onpointerdowncapture=\{[^}]*overlays\.pressed\(event\)/)
    expect(app).toMatch(/onclickcapture=\{\(event: MouseEvent\) => overlays\.clicked\(event\)\}/)
  })

  test('which is where every menu a button opens goes, with the button that opened it', () => {
    const menu = readFileSync(join(SOURCE, 'lib/ContextMenu.svelte'), 'utf8')
    expect(menu).toMatch(
      /overlays\.show\(\s*\(\) => menu\.hide\(\),\s*\(\) => \[element\],\s*menu\.from/,
    )
  })

  test('and the lists of exceptions name files that are there', () => {
    const all = new Set(sources().map((path) => relative(SOURCE, path).replace(/\\/g, '/')))
    for (const name of [...Object.keys(NOT_LAYERS), ...NOT_YET])
      expect(all.has(name), name).toBe(true)
  })
})
