import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'
import { COVERS } from '../src/lib/web-tab/covers'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const RUNG =
  /z-index:[^;]*var\(--z-(?:popover|float|bar|drawer|screen|notice|cover|settings|store|sheet|menu|lightbox|stage|carried)\)/

const NEVER_OVER_A_PAGE: Record<string, string> = {
  'App.svelte .fab': 'a touch screen only, which builds no native page',
  'App.svelte .notices': 'the row itself; each card in it is a layer of the registry',
  'App.svelte .notices.over': 'the same row, over a drawer: see .notices and .panels',
  'App.svelte .notices.above': 'the same row, over the tab overview: see .notices',
  'App.svelte .panels':
    'fixed only as a drawer, which is a phone or a tablet, and those build no native page',
  'App.svelte .panels.right': 'the right drawer: see .panels',
  'App.svelte .scrim': 'the drawers’ scrim, shown only where there are drawers: see .panels',
  'lib/Select.svelte .sheet': 'a touch screen only, and over its own .nib-scrim',
  'lib/FormatBar.svelte .docked': 'a touch screen only, docked over the keyboard',
  'lib/StatusBar.svelte .mode': 'the vim mode, drawn in the corner of a note’s own pane',
  'lib/overview/Overview.svelte .under':
    'the tab overview, which holds every page still as its picture while it is up (`holdStill` in web-tab/pages.svelte.ts)',
  'lib/overview/Overview.svelte .floor':
    'the tab overview, which holds every page still as its picture while it is up (`holdStill` in web-tab/pages.svelte.ts)',
  'lib/overview/Overview.svelte .top':
    'the tab overview, which holds every page still as its picture while it is up (`holdStill` in web-tab/pages.svelte.ts)',
  'lib/overview/Overview.svelte .window':
    'the tab overview, which holds every page still as its picture while it is up (`holdStill` in web-tab/pages.svelte.ts)',
  'lib/overview/Overview.svelte .closer':
    'the tab overview, which holds every page still as its picture while it is up (`holdStill` in web-tab/pages.svelte.ts)',
  'lib/overview/Overview.svelte .rider':
    'the tab overview, which holds every page still as its picture while it is up (`holdStill` in web-tab/pages.svelte.ts)',
  'lib/overview/Overview.svelte .window.is-front':
    'the same, stacked over its neighbours: see .window',
  'lib/overview/Overview.svelte .window.is-held':
    'the same, stacked over its neighbours: see .window',
  'lib/overview/Overview.svelte .closer.is-front':
    'the same, stacked over its neighbours: see .closer',
  'lib/overview/Overview.svelte .closer.is-held':
    'the same, stacked over its neighbours: see .closer',
  'lib/overview/Overview.svelte .rider.is-front':
    'the same, stacked over its neighbours: see .rider',
  'lib/even/Glasses.svelte .frame': 'the glasses’ plugin, which places no page',
  'lib/tab-strip/TabChip.svelte .chip':
    'the tab carried out of a strip, which hangs only while a drag is over the panes - and a drag covers all of every page (`coverOf` in WebTab.svelte)',
  'lib/tab-strip/TabNumbers.svelte .numeral': 'on the tabs of a strip, which no page is under',
}

const MADE_BY: Record<string, string> = {
  'lib/Tree.svelte .row.carried': 'lib/tree-lift.ts',
}

interface Node {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  [key: string]: unknown
}

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return components(path)
    return one.name.endsWith('.svelte') ? [path] : []
  })
}

function classesOf(node: Node): string[] {
  const words: string[] = []
  for (const one of node.attributes ?? []) {
    if (one.type === 'ClassDirective' && one.name) words.push(one.name)
    if (one.type !== 'Attribute' || one.name !== 'class' || !Array.isArray(one.value)) continue
    for (const part of one.value as { type: string; data?: string }[])
      if (part.type === 'Text') words.push(...(part.data ?? '').split(/\s+/))
  }
  return words.filter(Boolean)
}

const SHAPES: readonly string[] = [...COVERS.floating, ...COVERS.whole]

function registered(node: Node): boolean {
  if (classesOf(node).some((one) => SHAPES.includes(one))) return true
  return (node.attributes ?? []).some((one) => one.name === 'data-covers')
}

function* elements(node: unknown, inside = false): Generator<{ node: Node; inside: boolean }> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* elements(one, inside)
    return
  }
  const one = node as Node
  let under = inside
  if (one.type === 'RegularElement' || one.type === 'SvelteElement') {
    yield { node: one, inside }
    under = inside || registered(one)
  }
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* elements(value, under)
  }
}

interface Rule {
  type: string
  prelude: { start: number; end: number }
  block: { start: number; end: number }
}

function* rules(node: unknown): Generator<Rule> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* rules(one)
    return
  }
  const one = node as { type?: string } & Record<string, unknown>
  if (one.type === 'Rule') yield one as unknown as Rule
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'parent' && value && typeof value === 'object') yield* rules(value)
  }
}

function subjects(prelude: string): string[][] {
  return prelude.split(',').map((selector) => {
    const last =
      selector
        .trim()
        .split(/\s*[\s>+~]\s*/)
        .pop() ?? ''
    const plain = last.replace(/:global\(([^)]*)\)/g, '$1')
    return [...plain.matchAll(/\.([\w-]+)/g)].map((match) => match[1] ?? '')
  })
}

interface Found {
  key: string
  file: string
  registered: boolean
  elements: number
}

function layersOfTheWindow(): Found[] {
  const found: Found[] = []
  for (const path of components(SRC)) {
    const file = path.slice(SRC.length).replaceAll('\\', '/')
    const source = readFileSync(path, 'utf8')
    const tree = parse(source, { modern: true })
    if (!tree.css) continue
    const all = [...elements(tree.fragment)]
    for (const rule of rules(tree.css.children)) {
      const body = source.slice(rule.block.start, rule.block.end)
      if (!/position:\s*fixed/.test(body) && !RUNG.test(body)) continue
      const prelude = source.slice(rule.prelude.start, rule.prelude.end).replace(/\s+/g, ' ')
      for (const classes of subjects(prelude)) {
        if (classes.length === 0) continue
        const key = `${file} .${classes.join('.')}`
        const hits = all.filter((one) =>
          classes.every((name) => classesOf(one.node).includes(name)),
        )
        found.push({
          key,
          file,
          elements: hits.length,
          registered: hits.length > 0 && hits.every((one) => one.inside || registered(one.node)),
        })
      }
    }
  }
  return found
}

const found = layersOfTheWindow()

test('every layer of the window is in the registry of what covers a page, or says why not', () => {
  expect(found.length).toBeGreaterThan(50)
  const missing = found
    .filter((one) => one.elements > 0 && !one.registered)
    .map((one) => one.key)
    .filter((key) => !(key in NEVER_OVER_A_PAGE))
  expect([...new Set(missing)]).toEqual([])
})

test('a layer a script makes is registered by the script that makes it', () => {
  const made = found.filter((one) => one.elements === 0).map((one) => one.key)
  for (const key of made) expect(MADE_BY, key).toHaveProperty([key])
  for (const [key, script] of Object.entries(MADE_BY)) {
    expect(made).toContain(key)
    expect(readFileSync(join(SRC, script), 'utf8')).toMatch(/dataset\.covers\s*=/)
  }
})

test('nothing is excused that is in the registry after all, or is no layer any more', () => {
  for (const key of Object.keys(NEVER_OVER_A_PAGE)) {
    const one = found.filter((each) => each.key === key)
    expect(one.length, key).toBeGreaterThan(0)
    expect(
      one.every((each) => !each.registered),
      key,
    ).toBe(true)
  }
})

const PLACED_INSIDE: Record<string, string> = {
  'lib/web-tab/WebAsk.svelte .ask':
    'under a web tab’s bar, inside the tab it is about, which it never leaves',
  'lib/web-tab/WebDialog.svelte .dialog': 'under a web tab’s bar: see WebAsk',
  'lib/web-tab/WebDownloads.svelte .downloads': 'under a web tab’s bar: see WebAsk',
  'lib/web-tab/WebExtensionPopup.svelte .popup.sized': 'under a web tab’s bar: see WebAsk',
  'lib/web-tab/WebExtensions.svelte .extensions': 'under a web tab’s bar: see WebAsk',
  'lib/web-tab/WebSite.svelte .site': 'under a web tab’s bar: see WebAsk',
}

test('every bubble is placed in the window, where nothing that holds it can cut it', () => {
  const OWN = new Set(['nib-bubble', 'is-pressable', 'nib-host'])
  const bubbles: string[] = []
  const cut: string[] = []
  for (const path of components(SRC)) {
    const file = path.slice(SRC.length).replaceAll('\\', '/')
    const source = readFileSync(path, 'utf8')
    const tree = parse(source, { modern: true })
    const placing = [...rules(tree.css?.children ?? [])].map((rule) => ({
      subjects: subjects(source.slice(rule.prelude.start, rule.prelude.end).replace(/\s+/g, ' ')),
      body: source.slice(rule.block.start, rule.block.end),
    }))
    for (const { node } of elements(tree.fragment)) {
      const classes = classesOf(node)
      if (!classes.includes('nib-bubble')) continue
      const own = classes.filter((one) => !OWN.has(one))
      const key = `${file} .${own.join('.') || 'nib-bubble'}`
      bubbles.push(key)
      if (key in PLACED_INSIDE) continue
      const bodies = placing
        .filter((rule) =>
          rule.subjects.some(
            (subject) =>
              subject.some((one) => own.includes(one)) &&
              subject.every((one) => classes.includes(one)),
          ),
        )
        .map((rule) => rule.body)
      if (bodies.some((body) => /position:\s*absolute/.test(body))) cut.push(`${key}: absolute`)
      else if (!bodies.some((body) => /position:\s*fixed/.test(body)))
        cut.push(`${key}: not placed in the window`)
      const hung = (node.attributes ?? []).some(
        (one) => one.type === 'UseDirective' && one.name === 'hang',
      )
      if (hung && !bodies.some((body) => /position:\s*fixed/.test(body)))
        cut.push(`${key}: hung, but not fixed`)
    }
  }
  expect(bubbles.length).toBeGreaterThan(12)
  expect(cut).toEqual([])
})
