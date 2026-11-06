import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

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

function* elements(node: unknown, inRow = false): Generator<{ node: Node; inRow: boolean }> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* elements(one, inRow)
    return
  }

  const one = node as Node
  let under = inRow
  if (one.type === 'RegularElement') {
    yield { node: one, inRow }
    under = inRow || classesOf(one).includes('nib-setting')
  }
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* elements(value, under)
  }
}

test('no row of settings ends in an action that is as wide as a card', () => {
  const files = components(SRC)
  expect(files.length).toBeGreaterThan(100)

  const wide = files.flatMap((file) => {
    const tree = parse(readFileSync(file, 'utf8'), { modern: true })
    return [...elements(tree.fragment)]
      .filter((one) => one.inRow && classesOf(one.node).includes('nib-action'))
      .map(() => file.slice(SRC.length).replaceAll('\\', '/'))
  })

  expect(wide).toEqual([])
})

function* children(node: unknown): Generator<Node> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* children(one)
    return
  }
  const one = node as Node
  if (one.type === 'RegularElement') {
    yield one
    return
  }
  if (one.type === 'Component') return
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* children(value)
  }
}

function says(node: Node): boolean {
  const nodes = (node.fragment as { nodes?: Node[] } | undefined)?.nodes ?? []
  return nodes.some(
    (one) =>
      (one.type === 'Text' && typeof one.data === 'string' && one.data.trim() !== '') ||
      one.type === 'ExpressionTag',
  )
}

test('the words a row of settings is named by are its .name', () => {
  const WORDS = new Set(['span', 'div', 'p', 'strong', 'small'])
  const VALUES = new Set(['name', 'text', 'hint', 'value', 'is-value', 'key', 'mark'])
  const bare = components(SRC).flatMap((file) => {
    const tree = parse(readFileSync(file, 'utf8'), { modern: true })
    return [...elements(tree.fragment)]
      .filter(({ node }) => classesOf(node).includes('nib-setting'))
      .flatMap(({ node }) => [...children(node.fragment)])
      .filter((child) => WORDS.has(child.name ?? '') && says(child))
      .filter((child) => !classesOf(child).some((one) => VALUES.has(one)))
      .map(
        (child) =>
          `${file.slice(SRC.length).replaceAll('\\', '/')} ${child.name}.${classesOf(child).join('.')}`,
      )
  })

  expect(bare).toEqual([])
})

function ruleOf(sheet: string, selector: string): string {
  const at = sheet.indexOf(`\n${selector} {`)
  expect(at, `${selector.trim()} in its sheet`).toBeGreaterThan(-1)
  return sheet.slice(at, sheet.indexOf('}', at))
}

test("a row's name keeps a readable width and what does not fit beside it wraps under it", () => {
  const sheet = readFileSync(
    fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url)),
    'utf8',
  )

  expect(ruleOf(sheet, '.nib-setting')).toMatch(/flex-wrap:\s*wrap/)
  expect(ruleOf(sheet, '.nib-setting > .name')).toMatch(
    /min-inline-size:\s*min\(\d+(\.\d+)?rem,\s*100%\)\s*!important/,
  )
  expect(ruleOf(sheet, '.nib-setting > .name + *')).toMatch(/margin-inline-start:\s*auto/)
  expect(ruleOf(sheet, '.nib-setting > .name ~ *')).toMatch(/max-inline-size:\s*100%/)
})

test('a dropdown in a row and a pane in the list are as long as their words', () => {
  const panel = readFileSync(join(SRC, 'lib/SettingsPanel.svelte'), 'utf8')
  const sheet = readFileSync(
    fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url)),
    'utf8',
  )

  expect(ruleOf(sheet, '.nib-setting-value')).toMatch(
    /min-inline-size:\s*min\(var\(--setting-value\),\s*100%\)/,
  )
  expect(ruleOf(sheet, '.nib-setting-value')).not.toMatch(/[\s;](inline-size|width):/)
  expect(ruleOf(panel, '  .item .nib-row-label')).toMatch(/white-space:\s*normal/)
})
