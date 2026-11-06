import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const E2E = join(ROOT, 'apps', 'desktop', 'test', 'e2e')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

const caught = (found: RegExpMatchArray, at = 1): string => found[at] ?? ''

const drives = readdirSync(E2E)
  .filter((name) => name.endsWith('.py'))
  .sort()

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourcesUnder(path, found)
    else if (/\.(ts|svelte|css|html)$/.test(entry.name)) found.push(path)
  }

  return found
}

const sources = [
  ...sourcesUnder(join(ROOT, 'apps', 'desktop', 'src')),
  ...sourcesUnder(join(ROOT, 'packages')),
  ...sourcesUnder(join(ROOT, 'services')),
]

const IN_CSS = /\.(-?[A-Za-z_][\w-]*)/g
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/g

const ATTRIBUTE = /\bclass\s*[=:]\s*["'`]([^"'`]*)["'`]/g
const DIRECTIVE = /\bclass:(-?[A-Za-z_][\w-]*)/g
const ELEMENT = /\b(?:classList\.(?:add|remove|toggle|contains)|addLineClass)\(([^)]*)\)/g
const PROPERTY = /\bclassName\s*=\s*["'`]([^"'`]*)["'`]/g

const classes = new Set<string>()
const ids = new Set<string>()
const data = new Set<string>()

function split(text: string, into: Set<string>): void {
  for (const one of text.split(/[\s${}()?:+\\]+/)) if (one) into.add(one.replace(/^\./, ''))
}

function classesIn(path: string, text: string, into: Set<string>): void {
  if (path.endsWith('.css')) for (const found of text.matchAll(IN_CSS)) into.add(caught(found))
  else
    for (const block of text.matchAll(STYLE))
      for (const found of caught(block).matchAll(IN_CSS)) into.add(caught(found))

  for (const found of text.matchAll(ATTRIBUTE)) split(caught(found), into)
  for (const found of text.matchAll(DIRECTIVE)) into.add(caught(found))
  for (const found of text.matchAll(PROPERTY)) split(caught(found), into)
  for (const found of text.matchAll(ELEMENT))
    for (const one of caught(found).matchAll(/["'`]([^"'`]+)["'`]/g)) split(caught(one), into)
}

for (const path of sources) {
  const text = read(path)
  classesIn(path, text, classes)

  for (const found of text.matchAll(/\bid\s*[=:]\s*["'`]([^"'`${}]*)["'`]/g))
    split(caught(found), ids)
  for (const found of text.matchAll(/#(-?[A-Za-z_][\w-]*)/g)) ids.add(caught(found))

  for (const found of text.matchAll(/\bdata-([a-z][\w-]*)/g)) data.add(caught(found))
  for (const found of text.matchAll(/\bdataset\.([A-Za-z]\w*)/g))
    data.add(caught(found).replace(/[A-Z]/g, (one) => `-${one.toLowerCase()}`))
}

const ASKED =
  /(?:querySelectorAll|querySelector|closest|matches|locator|click|hover|wait_for_selector|eval_on_selector(?:_all)?|is_visible|fill|dblclick|scroll_to)\s*\(\s*f?(["'`])((?:\\.|(?!\1).)*)\1/g

const HELD = /classList\.contains\(\s*f?(["'`])((?:\\.|(?!\1).)*)\1/g

const NOT_OURS = /^(?:cm-|ytp-|vp-)/

function strangers(selector: string): string[] {
  const gone: string[] = []
  const part = selector.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""')

  for (const found of part.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
    const name = caught(found)
    if (!NOT_OURS.test(name) && !classes.has(name)) gone.push(`.${name}`)
  }
  for (const found of part.matchAll(/#(-?[A-Za-z_][\w-]*)/g))
    if (!ids.has(caught(found))) gone.push(`#${caught(found)}`)
  for (const found of part.matchAll(/\[data-([a-z][\w-]*)/g))
    if (!data.has(caught(found))) gone.push(`[data-${caught(found)}]`)

  return gone
}

function forgotten(selector: string): string[] {
  let worst: string[] = []

  for (const part of selector.replace(/\{[^}]*\}/g, '').split(',')) {
    const gone = strangers(part)
    if (!gone.length) return []
    if (!worst.length || gone.length < worst.length) worst = gone
  }

  return worst
}

describe('the names a drive points at', () => {
  test('the app writes names at all', () => {
    expect(classes.size).toBeGreaterThan(500)
    expect(ids).toContain('write')
    expect(data).toContain('callout')
  })

  test.each(drives)('%s points at names the app still writes', (name) => {
    const text = read(E2E, name)
    const selectors = new Set<string>()
    for (const found of text.matchAll(ASKED))
      if (!caught(found, 2).includes('://')) selectors.add(caught(found, 2))
    for (const found of text.matchAll(HELD)) selectors.add(`.${caught(found, 2)}`)

    const stale = [...selectors]
      .map((one) => ({ one, gone: forgotten(one) }))
      .filter((found) => found.gone.length)
      .map((found) => `${found.one} → ${found.gone.join(' ')}`)
      .sort()

    expect(stale, `${name} asks for names nothing in the app writes`).toEqual([])
  })
})

function drawnBy(path: string, found = new Set<string>()): Set<string> {
  if (found.has(path) || !existsSync(path)) return found
  found.add(path)
  for (const one of read(path).matchAll(/from\s+'(\.{1,2}\/[^']+\.svelte)'/g))
    drawnBy(join(path, '..', caught(one)), found)
  return found
}

const bar = new Set<string>()
for (const path of drawnBy(join(ROOT, 'apps', 'desktop', 'src', 'lib', 'Titlebar.svelte')))
  classesIn(path, read(path), bar)

describe('the names a drive looks for in the top bar', () => {
  test('the bar writes names at all', () => {
    expect(bar).toContain('title')
    expect(bar).toContain('toggle')
  })

  test.each(drives)('%s looks in the bar for what the bar draws', (name) => {
    const text = read(E2E, name)
    const stale = new Set<string>()
    for (const found of text.matchAll(/(["'`])(header\b(?:(?!\1).)*)\1/g)) {
      for (const part of caught(found, 2)
        .replace(/\{[^}]*\}/g, '')
        .split(',')) {
        const inBar = /^\s*header\b(?:\[[^\]]*\])?\s+(.*)$/.exec(part)
        if (!inBar) continue
        for (const one of caught(inBar).matchAll(/\.(-?[A-Za-z_][\w-]*)/g))
          if (!bar.has(caught(one))) stale.add(`${part.trim()} → .${caught(one)}`)
      }
    }
    expect([...stale].sort(), `${name} looks in the bar for what it no longer draws`).toEqual([])
  })
})

describe('the build a drive steers', () => {
  const CONFIG = read(ROOT, 'apps', 'desktop', 'vite.config.ts')

  const driveable = [...CONFIG.matchAll(/mode === '([^']+)'/g)].map((found) => caught(found))

  function modesIn(text: string): string[] {
    return [
      ...[...text.matchAll(/"--mode",\s*"([^"]+)"/g)].map((found) => caught(found)),
      ...[...text.matchAll(/--mode ([a-z][\w-]*)/g)].map((found) => caught(found)),
    ]
  }

  test('the config still says which modes may be driven', () => {
    expect(CONFIG).toContain('__DRIVEABLE__')
    expect(driveable).toContain('drive')
  })

  test.each(drives)('%s builds a build a drive may steer', (name) => {
    for (const mode of modesIn(read(E2E, name))) {
      expect(driveable, `${name} builds --mode ${mode}, which carries no handle`).toContain(mode)
    }
  })
})

describe('the activity a drive stands in for', () => {
  const BRIDGE = read(ROOT, 'apps', 'desktop', 'src', 'lib', 'mobile', 'bridge.ts')

  const declared = new Map<string, string[]>()
  const block = BRIDGE.slice(BRIDGE.indexOf('export interface NibSystem {'))
  for (const found of block.slice(0, block.indexOf('\n}')).matchAll(/^\s*(\w+)\(([^)]*)\)/gm)) {
    declared.set(
      caught(found),
      caught(found, 2)
        .split(',')
        .map((one) => (one.split(':')[0] ?? '').trim())
        .filter(Boolean),
    )
  }

  function shimIn(text: string): string | null {
    const at = text.indexOf('__NIB_SYSTEM__ = {')
    return at === -1 ? null : text.slice(at)
  }

  const standIns = drives.filter((name) => shimIn(read(E2E, name)))

  test('the two sides are both there to be read', () => {
    expect([...declared.keys()]).toContain('listen')
    expect(standIns.length).toBeGreaterThan(0)
  })

  test.each(standIns)('%s stands in for the bridge the app talks over', (name) => {
    const shim = shimIn(read(E2E, name)) ?? ''
    const wrong: string[] = []

    for (const found of shim.matchAll(/^\s{4}(\w+):\s*\(([^)]*)\)\s*=>/gm)) {
      const method = caught(found)
      const taken = caught(found, 2)
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean)
      const wanted = declared.get(method)

      if (!wanted) {
        wrong.push(`${method} is not on the bridge any more`)
        continue
      }

      if (wanted.slice(0, taken.length).join() !== taken.join()) {
        wrong.push(`${method}(${taken.join(', ')}) stands in for ${method}(${wanted.join(', ')})`)
      }
    }

    expect(wrong, `${name} stands in for an activity the app no longer talks to`).toEqual([])
  })
})
